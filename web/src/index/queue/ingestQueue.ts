// The one background queue (01 section 11.1, 20 section 13): label (Gemini Nano), embed (the ML worker), the privacy
// scan (11's scanRecord: plain code and the privacy model, no Gemini Nano) and photo captions (Gemini Nano), newest
// first, versioned writes, pausable, progress and ETA. The lanes run one at a time in QUEUE_LANE_ORDER with a rest
// after every job (serial.ts); the model lanes hold on battery and captions run on power only, at most
// CAPTION_SESSION_MAX per session (QUEUE_PACING.captionSessionMax). Questions go first: 10's scheduler preempts background Nano calls and the ML
// worker serves foreground jobs first.
import { CATEGORIES, DEFAULT_CATEGORY_RULES, EMBEDDING_DIMS, EMBEDDING_MODEL, PREVIEW_CHARS } from '@sieve/shared';
import type { Category, CategoryRule, IndexRecord, SourceKind } from '@sieve/shared';
import { getMl, MlUnavailableError } from '../../ml/client';
import type { EmbedInput, EmbedOutput } from '../../ml/protocol';
import { embedTexts } from '../chunk';
import {
  EMBED_BATCH, LABEL_BATCH_SIZE, QUEUE_IDLE_RECHECK_MS, QUEUE_LANE_ORDER, QUEUE_PACING, SOURCE_ROW_WRITE_MS, STAGE_RETRY_DELAYS_MS,
  URGENT_FLUSH_MS,
} from '../config';
import { applyRecordInMemory, writeIfCurrentDetailed } from '../consistency';
import { dataClassOf, type IndexingStage, type SieveDb, type SourceRow, type VectorRow } from '../db';
import { aiApi, loadPrivacyScanApi, privacyScanApi } from '../deps';
import { isPhotoPlaceholder } from '../preview';
import { getRuntime } from '../runtime';
import { cutGraphemes } from '../text';
import { overallEtaMs, priorCosts, restEtaMs, type QueueStage } from './eta';
import { runSerial, sleep, type JobResult, type Lane } from './serial';

export interface QueueProgress {
  stage: QueueStage; done: number; total: number;
  // 'power': held on battery (captions: waiting for the charger); 'off': captions switched off; 'limit': the session cap
  waiting: null | 'model' | 'consent' | 'permission' | 'paused' | 'power' | 'off' | 'limit'; secPerItem: number; etaMs: number;
}

/** What the device allows the model lanes (20 section 13.5). 40's useIndexing sets it for the real database. */
export interface QueueConditions {
  onBattery: boolean;          // navigator.getBattery() reports the machine is not charging; false without the API
  batteryOverride: boolean;    // the person pressed Resume on battery; lasts for the session
  captions: boolean;           // the "Describe photos with Gemini Nano" switch (Sources)
}
const DEFAULT_CONDITIONS: QueueConditions = { onBattery: false, batteryOverride: false, captions: true };

export interface ScanQueueStatus { queued: number; running?: string; done: number; paused: boolean }
/** 11's PrivacyScanQueue interface (11 section 2.3), implemented here as the queue's privacy lane (01 section 11.1). */
export interface PrivacyScanQueue {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  enqueue(ids: string[]): void;
  scanNow(id: string, signal?: AbortSignal): Promise<IndexRecord | undefined>;
  refreshAll(): void;
  status(): ScanQueueStatus;
  onChange(cb: (s: ScanQueueStatus) => void): () => void;
}

export interface IngestQueue {
  start(): void;
  stop(): Promise<void>;
  enqueue(ids: string[], opts?: { priority?: 'normal' | 'high' }): void;
  cancel(ids: string[]): void;
  pause(): void;
  resume(): void;
  setCategoryRules(rules: Record<Category, CategoryRule>): void;
  progress(): QueueProgress[];
  subscribe(fn: (p: QueueProgress[]) => void): () => void;
  /** Resolves when nothing is queued or running in any lane (tests, /dev/seed). Stages that wait for a model count as idle. */
  whenIdle(): Promise<void>;
  /** Records of a source still waiting for a stage (Sources progress). */
  pendingBySource(): Map<SourceKind, number>;
  /**
   * Before a question's retrieval (20 section 13.5): resolves when every item enqueued with priority 'high' (a file
   * just added, a Playground add, a live Gmail hit, a share-time re-index) has its vectors, or after `timeoutMs`.
   * 'skipped': nothing can run now (paused, on battery, the embedder not ready), so the question searches at once.
   */
  flushUrgent(timeoutMs?: number, signal?: AbortSignal): Promise<'done' | 'timeout' | 'skipped'>;
  readonly privacy: PrivacyScanQueue;
  readonly paused: boolean;
}

type Stage = QueueStage;
const STAGES: readonly Stage[] = QUEUE_LANE_ORDER;

/** Newest first; high priority at the front. `urgent`: ids enqueued with priority 'high' (a person is waiting). */
class StageList {
  private high: string[] = [];
  private normal: string[] = [];
  private members = new Set<string>();
  private urgentIds = new Set<string>();
  constructor(private readonly dateOf: (id: string) => number) {}
  get size(): number {
    return this.members.size;
  }
  has(id: string): boolean {
    return this.members.has(id);
  }
  /** Work a person is waiting for is queued here (retries and preempted items moved to the front are not). */
  hasUrgent(): boolean {
    return this.urgentIds.size > 0;
  }
  add(id: string, priority: 'normal' | 'high'): boolean {
    if (priority === 'high') this.urgentIds.add(id);
    if (this.members.has(id)) {
      if (priority === 'high' && !this.high.includes(id)) {
        this.normal = this.normal.filter((x) => x !== id);
        this.high.unshift(id);
      }
      return false;
    }
    this.members.add(id);
    if (priority === 'high') {
      this.high.unshift(id);
      return true;
    }
    const d = this.dateOf(id);
    let lo = 0;
    let hi = this.normal.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.dateOf(this.normal[mid] ?? '') >= d) lo = mid + 1;
      else hi = mid;
    }
    this.normal.splice(lo, 0, id);
    return true;
  }
  front(id: string): void {
    this.members.add(id);
    this.normal = this.normal.filter((x) => x !== id);
    this.high = this.high.filter((x) => x !== id);
    this.high.unshift(id);
  }
  remove(id: string): boolean {
    this.urgentIds.delete(id);
    if (!this.members.delete(id)) return false;
    this.high = this.high.filter((x) => x !== id);
    this.normal = this.normal.filter((x) => x !== id);
    return true;
  }
  take(n: number, ok: (id: string) => boolean = () => true): string[] {
    const out: string[] = [];
    for (const list of [this.high, this.normal]) {
      for (const id of list) {
        if (out.length >= n) break;
        if (ok(id)) out.push(id);
      }
    }
    for (const id of out) this.remove(id);
    return out;
  }
  ids(): string[] {
    return [...this.high, ...this.normal];
  }
  clear(): void {
    this.high = [];
    this.normal = [];
    this.members.clear();
    this.urgentIds.clear();
  }
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string })?.name === 'AbortError' || (e as { code?: string })?.code === 'aborted';
}

const queues = new Map<SieveDb, IngestQueue>();
const conditionsByDb = new Map<SieveDb, QueueConditions>();
const conditionListeners = new Map<SieveDb, () => void>();

/** Battery, the battery override and the captions switch for a database's queue; kept for a queue started later. */
export function setQueueConditions(db: SieveDb, next: Partial<QueueConditions>): void {
  conditionsByDb.set(db, { ...(conditionsByDb.get(db) ?? DEFAULT_CONDITIONS), ...next });
  conditionListeners.get(db)?.();
}

function conditionsOf(db: SieveDb): QueueConditions {
  return conditionsByDb.get(db) ?? DEFAULT_CONDITIONS;
}

/** The queue of a database, if started. */
export function peekQueue(db: SieveDb): IngestQueue | undefined {
  return queues.get(db);
}

/** 20 section 13.5: a question waits for just-added items' vectors, URGENT_FLUSH_MS at most; no queue here: no wait. */
export function flushUrgentEmbeds(db: SieveDb, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<'done' | 'timeout' | 'skipped'> {
  const q = queues.get(db);
  return q ? q.flushUrgent(opts.timeoutMs ?? URGENT_FLUSH_MS, opts.signal) : Promise.resolve('done');
}

/** Leader tab only; one per open database (a second call returns the same queue). */
export function startIngestQueue(db: SieveDb): IngestQueue {
  const existing = queues.get(db);
  if (existing) {
    existing.start();
    return existing;
  }
  const q = createIngestQueue(db);
  queues.set(db, q);
  q.start();
  return q;
}

/** Stops and forgets the queue of a database (wipeDb, disconnect of everything, tests). */
export async function stopIngestQueue(db: SieveDb): Promise<void> {
  const q = queues.get(db);
  if (!q) return;
  queues.delete(db);
  await q.stop();
}

function createIngestQueue(db: SieveDb): IngestQueue {
  const rt = getRuntime(db);
  let rules: Record<Category, CategoryRule> = { ...DEFAULT_CATEGORY_RULES };
  const dateOf = (id: string) => rt.meta.get(id)?.date ?? 0;
  const lists: Record<Stage, StageList> = {
    label: new StageList(dateOf), caption: new StageList(dateOf), embed: new StageList(dateOf), privacy: new StageList(dateOf),
  };
  const inflight: Record<Stage, Set<string>> = { label: new Set(), caption: new Set(), embed: new Set(), privacy: new Set() };
  const totals: Record<Stage, { done: number; total: number }> = {
    label: { done: 0, total: 0 }, caption: { done: 0, total: 0 }, embed: { done: 0, total: 0 }, privacy: { done: 0, total: 0 },
  };
  const waiting: Record<'label' | 'caption' | 'embed', QueueProgress['waiting']> = { label: null, caption: null, embed: null };
  const costs = priorCosts();
  let chunksPerRecord = 1.5;
  const attempts = new Map<string, number>();
  const skipped = new Set<string>();
  const listeners = new Set<(p: QueueProgress[]) => void>();
  const privacyListeners = new Set<(s: ScanQueueStatus) => void>();
  let privacyDone = 0;
  let privacyRunning: { id: string; controller: AbortController; done: Promise<void> } | null = null;
  let running = false;
  let paused = false;
  let loop: Promise<void> | null = null;
  let stopController = new AbortController();
  let waker: (() => void) | null = null;
  // A wake that arrives while the loop is working, or between its last empty check and its sleep (an await apart),
  // is kept here, so the next wait ends at once instead of waiting out QUEUE_IDLE_RECHECK_MS.
  let wakePending = false;
  let current: Lane | null = null;
  let idleWaiters: (() => void)[] = [];
  let unsubNano: (() => void) | null = null;
  let unsubMl: (() => void) | null = null;
  let unsubPrivacyModel: (() => void) | null = null;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let backlogBuilt = false;
  let enqueuing = 0;
  let privacyLoaded = false;
  // Records seen before 11's scan functions loaded; their freshness is checked once they have (20 section 13.3).
  const privacyUnchecked = new Set<string>();
  let privacyChecks = 0;
  let captionsRun = 0;
  // 20 section 13.5: embeddings a person is waiting for (priority 'high'), and the questions waiting on them
  const urgentEmbeds = new Set<string>();
  let urgentEnqueuing = 0;
  let flushWaiters: (() => void)[] = [];
  const urgentSettled = () => urgentEnqueuing === 0 && urgentEmbeds.size === 0;
  const checkFlush = () => {
    if (flushWaiters.length === 0 || !urgentSettled()) return;
    const ws = flushWaiters;
    flushWaiters = [];
    for (const w of ws) w();
  };

  const key = (stage: Stage, id: string) => `${stage}:${id}`;

  const wake = () => {
    const w = waker;
    waker = null;
    if (w) w();
    else wakePending = true;
  };

  const waitForWork = (ms = QUEUE_IDLE_RECHECK_MS) =>
    new Promise<void>((resolve) => {
      if (wakePending) {
        wakePending = false;
        resolve();
        return;
      }
      const t = setTimeout(() => {
        waker = null;
        resolve();
      }, ms);
      waker = () => {
        clearTimeout(t);
        resolve();
      };
      checkIdle();
    });

  // ---------- conditions: battery and the captions switch ----------

  /** On battery without the person's Resume: every model lane holds, like a pause the device made. */
  const heldOnBattery = () => {
    const c = conditionsOf(db);
    return c.onBattery && !c.batteryOverride;
  };
  const held = () => paused || heldOnBattery();
  /** Captions: switched on, on power (the battery override does not cover them) and under the session cap. */
  const captionBlock = (): 'off' | 'power' | 'limit' | null => {
    const c = conditionsOf(db);
    if (!c.captions) return 'off';
    if (c.onBattery) return 'power';
    if (captionsRun >= QUEUE_PACING.captionSessionMax) return 'limit';
    return null;
  };

  /** The privacy model is ready or has failed: a scan will not sit waiting for its download (20 section 13.1). */
  const privacyModelSettled = (): boolean => {
    const state = privacyScanApi()?.getPrivacyModelStatus?.().state;
    return state === undefined || state === 'ready' || state === 'failed';
  };

  const runnable = (lane: Lane): boolean => {
    if (lane === 'label') return lists.label.size > 0 && waiting.label === null;
    if (lane === 'embed') return lists.embed.size > 0 && waiting.embed === null;
    if (lane === 'privacy') return lists.privacy.size > 0 && privacyScanApi() !== null && privacyModelSettled();
    return lists.caption.size > 0 && waiting.caption === null && captionBlock() === null;
  };

  const isIdle = () =>
    enqueuing === 0 && privacyChecks === 0 && (privacyLoaded || !running) && (backlogBuilt || !running)
    && current === null && (held() || !STAGES.some(runnable));

  // Waiters and listeners run in a fresh task: called from inside a Dexie promise chain they would inherit that
  // transaction's zone, and a write they start would wait on a finished transaction.
  const outside = (fn: () => void) => setTimeout(fn, 0);

  const checkIdle = () => {
    const idle = isIdle();
    if (!idle) return;
    const ws = idleWaiters;
    idleWaiters = [];
    if (ws.length > 0) outside(() => ws.forEach((w) => w()));
  };

  const snapshot = (): QueueProgress[] =>
    STAGES.map((stage) => {
      const t = totals[stage];
      const remaining = Math.max(0, t.total - t.done);
      const units = stage === 'embed' ? remaining * chunksPerRecord : remaining;
      const block = stage === 'caption' ? captionBlock() : null;
      let wait: QueueProgress['waiting'] = null;
      if (remaining > 0) {
        if (paused) wait = 'paused';
        else if (heldOnBattery()) wait = 'power';
        else if (block) wait = block;
        else wait = stage === 'privacy' ? null : waiting[stage];
      }
      const etaMs = block ? 0 : costs[stage].etaMs(units) + restEtaMs(stage, units);
      return { stage, done: t.done, total: t.total, waiting: wait, secPerItem: costs[stage].secPerItem, etaMs };
    });

  const emit = () => {
    const p = snapshot();
    for (const fn of [...listeners]) fn(p);
    scheduleSourceRows();
  };

  const emitPrivacy = () => {
    const s = privacyStatus();
    for (const fn of [...privacyListeners]) fn(s);
  };

  const sourceOf = (id: string): SourceKind => rt.meta.get(id)?.source ?? (id.split(':')[0] as SourceKind);

  /** Ids still waiting for a stage (queued or running). Captions count only while they may run. */
  const pendingIds = (stage: Stage): string[] => {
    if (stage === 'caption' && captionBlock() !== null) return [];
    return [...lists[stage].ids(), ...inflight[stage]];
  };

  const pendingBySource = (): Map<SourceKind, number> => {
    const ids = new Set<string>();
    for (const stage of STAGES) for (const id of pendingIds(stage)) ids.add(id);
    const out = new Map<SourceKind, number>();
    for (const id of ids) {
      const src = sourceOf(id);
      out.set(src, (out.get(src) ?? 0) + 1);
    }
    return out;
  };

  /** The lane working now, else the next one that can run. */
  const activeLane = (): Lane | null => current ?? (QUEUE_LANE_ORDER.find(runnable) ?? null);

  /** What the card says for one source: reading while its job reads files, else the lane its items wait for. */
  const rowStage = (kind: SourceKind): { stage?: IndexingStage; stageCount?: number } => {
    if ((rt.syncProgress.get(kind)?.remaining ?? 0) > 0) return { stage: 'reading' };
    const mine = (stage: Stage) => pendingIds(stage).filter((id) => sourceOf(id) === kind).length;
    const lane = activeLane();
    const stage = lane && mine(lane) > 0 ? lane : QUEUE_LANE_ORDER.find((l) => mine(l) > 0);
    if (!stage) return {};
    return stage === 'label' || stage === 'caption' ? { stage, stageCount: mine(stage) } : { stage };
  };

  const scheduleSourceRows = () => {
    if (progressTimer) return;
    progressTimer = setTimeout(() => {
      progressTimer = null;
      void writeSourceRows();
    }, SOURCE_ROW_WRITE_MS);
  };

  /**
   * The only writer of the rows' `progress` (20 section 13.4). `done` = items of the source with no stage left; within
   * a pass (from work appearing until none is left) it never goes down, even when an item gets new work (a new label
   * re-opens its embedding). `total` = items found; while the source job is still listing it only grows.
   */
  const passMarks = new Map<SourceKind, { done: number; total: number }>();
  const writeSourceRows = async () => {
    if (db.sieveKind !== 'real') return;
    const pending = pendingBySource();
    const eta = overallEtaMs(Object.fromEntries(snapshot().map((p) => [p.stage, p.etaMs])));
    try {
      const rows = await db.sources.toArray();
      for (const row of rows) {
        if (!row.connected || row.kind === 'playground') {
          passMarks.delete(row.kind);
          continue;
        }
        const sync = rt.syncProgress.get(row.kind);
        let count = 0;
        for (const m of rt.meta.values()) if (m.source === row.kind) count++;
        let total = Math.max(count, sync?.discovered ?? 0);
        const left = (pending.get(row.kind) ?? 0) + (sync?.remaining ?? 0);
        let done = Math.max(0, total - left);
        const mark = passMarks.get(row.kind);
        if (left > 0) {
          if (mark && sync?.listing) total = Math.max(total, mark.total);
          if (mark) done = Math.min(total, Math.max(done, mark.done));
          passMarks.set(row.kind, { done, total });
        } else {
          passMarks.delete(row.kind);
          done = total;
        }
        const etaMs = (sync?.etaMs ?? 0) + (left > 0 ? eta : 0);
        const { stage, stageCount }: { stage?: IndexingStage; stageCount?: number } = left > 0 ? rowStage(row.kind) : {};
        const counting = sync?.listing === true ? true : undefined;
        if (row.progress.done !== done || row.progress.total !== total || row.etaMs !== etaMs || row.stage !== stage || row.stageCount !== stageCount || row.counting !== counting) {
          const patch: Partial<SourceRow> = { progress: { done, total }, etaMs, stage, stageCount, counting };
          await db.sources.update(row.kind, patch);
        }
      }
    } catch {
      // the database is closing
    }
  };

  // ---------- what each record needs ----------

  const ruleOf = (rec: Pick<IndexRecord, 'category'>): CategoryRule => rules[rec.category] ?? 'ask-first';

  const needsLabel = (rec: IndexRecord): boolean => {
    if (rec.kind === 'photo' || rec.categoryBy === 'seed') return false;
    const m = rec.enrich?.label;
    if (!m) return true;
    if (m.by === 'seed') return false;
    if (m.v < aiApi.promptVersions().label) return true;
    return (m.by === 'code' || m.confidence === 'low') && (m.attempts ?? 0) < 2;
  };

  const needsCaption = (rec: IndexRecord): boolean => {
    if (rec.kind !== 'photo' || ruleOf(rec) === 'never') return false;
    if (rec.photo?.mime === 'image/heic' || rec.photo?.mime === 'image/heif') return false;
    if (!rec.caption) return (rec.enrich?.caption?.attempts ?? 0) < 3;
    if (rec.captionBy === 'seed') return false;
    const m = rec.enrich?.caption;
    return !m || m.v < aiApi.promptVersions().caption;
  };

  const needsEmbed = (rec: IndexRecord): boolean => {
    const plan = embedTexts(rec, ruleOf(rec));
    if (plan.inputs.length === 0) return rt.vectors.has(rec.id);   // stale rows of a photo that lost its caption
    return rt.vectors.versionOf(rec.id) !== rec.version || (rt.vectors.inputHashOf(rec.id) ?? plan.sourceHash) !== plan.sourceHash;
  };

  const add = (stage: Stage, id: string, priority: 'normal' | 'high') => {
    if (skipped.has(key(stage, id))) return;
    if (stage === 'embed' && priority === 'high') urgentEmbeds.add(id);
    const added = lists[stage].add(id, priority);
    if (added && !inflight[stage].has(id)) totals[stage].total++;
    if (added) wake();   // a loop that is asleep picks it up now, not at the next recheck
  };

  /** Queues the privacy scan only for a record whose scan is not current (so the progress counts real work). */
  const addPrivacy = (rec: IndexRecord, priority: 'normal' | 'high') => {
    if (skipped.has(key('privacy', rec.id))) return;
    if (lists.privacy.has(rec.id)) {
      if (priority === 'high') lists.privacy.add(rec.id, 'high');
      return;
    }
    const api = privacyScanApi();
    if (!api) {
      privacyUnchecked.add(rec.id);
      return;
    }
    privacyChecks++;
    void api.expectedStages(rec, dataClassOf(db, rec), ruleOf(rec))
      .then((expected) => {
        if (!api.isScanCurrent(rec, expected)) add('privacy', rec.id, priority);
      })
      .catch(() => add('privacy', rec.id, priority))
      .finally(() => {
        privacyChecks--;
        checkIdle();
      });
  };

  const finish = (stage: Stage, id: string) => {
    totals[stage].done = Math.min(totals[stage].total, totals[stage].done + 1);
    if (stage === 'embed' && urgentEmbeds.delete(id)) checkFlush();
    if (stage === 'privacy') {
      privacyDone++;
      emitPrivacy();
    }
  };

  const classify = (rec: IndexRecord, priority: 'normal' | 'high') => {
    if (needsLabel(rec)) add('label', rec.id, priority);
    if (needsCaption(rec)) add('caption', rec.id, priority);
    if (needsEmbed(rec)) add('embed', rec.id, priority);
    addPrivacy(rec, priority);
  };

  const enqueue = (ids: string[], opts?: { priority?: 'normal' | 'high' }) => {
    if (ids.length === 0) return;
    const priority = opts?.priority ?? 'normal';
    enqueuing++;
    if (priority === 'high') urgentEnqueuing++;
    void (async () => {
      try {
        const recs = await db.records.bulkGet(ids).catch(() => [] as (IndexRecord | undefined)[]);
        for (const rec of recs) if (rec) classify(rec, priority);
      } finally {
        enqueuing--;
        if (priority === 'high') {
          urgentEnqueuing--;
          checkFlush();
        }
        emit();
        wake();
        checkIdle();
      }
    })();
  };

  const cancel = (ids: string[]) => {
    for (const id of ids) {
      privacyUnchecked.delete(id);
      for (const stage of STAGES) {
        if (lists[stage].remove(id)) finish(stage, id);
      }
      for (const s of STAGES) for (const k of [...attempts.keys()]) if (k === key(s, id)) attempts.delete(k);
    }
    if (privacyRunning && ids.includes(privacyRunning.id)) privacyRunning.controller.abort();
    emit();
  };

  /** A failed (not aborted) item: retry later, and give up for this session after three tries. */
  const failed = async (stage: Stage, ids: string[], signal: AbortSignal): Promise<'retry' | 'skipped'> => {
    let anyRetry = false;
    for (const id of ids) {
      const n = (attempts.get(key(stage, id)) ?? 0) + 1;
      attempts.set(key(stage, id), n);
      if (n >= 3 && ids.length === 1) {
        skipped.add(key(stage, id));
        finish(stage, id);
      } else {
        anyRetry = true;
        lists[stage].front(id);
      }
    }
    if (anyRetry) {
      const n = Math.max(...ids.map((id) => attempts.get(key(stage, id)) ?? 1));
      await sleep(STAGE_RETRY_DELAYS_MS[Math.min(n - 1, STAGE_RETRY_DELAYS_MS.length - 1)] ?? 2_000, signal);
    }
    return anyRetry ? 'retry' : 'skipped';
  };

  // ---------- label ----------

  const labelOnce = async (signal: AbortSignal): Promise<JobResult> => {
    if (lists.label.size === 0) return 'none';
    const nano = await aiApi.nano();
    const canRun = (id: string) => {
      const m = rt.meta.get(id);
      if (!m) return true;   // the record is gone: taking it drops it
      return dataClassOf(db, m) === 'sample' || nano.text === 'available';
    };
    // one data class per call; a batch that failed three times is halved
    const firstId = lists.label.ids().find(canRun);
    if (!firstId) {
      waiting.label = 'model';
      return 'none';
    }
    waiting.label = null;
    const classOf = (id: string): 'own' | 'sample' => {
      const m = rt.meta.get(id);
      return m ? dataClassOf(db, m) : 'own';
    };
    const dataClass = classOf(firstId);
    const tries = attempts.get(key('label', firstId)) ?? 0;
    const size = tries >= 3 ? Math.max(1, Math.floor(LABEL_BATCH_SIZE / 2 ** Math.min(tries - 2, 4))) : LABEL_BATCH_SIZE;
    const ids = lists.label.take(size, (id) => canRun(id) && classOf(id) === dataClass);
    for (const id of ids) inflight.label.add(id);
    try {
      const recs = (await db.records.bulkGet(ids)).filter((r): r is IndexRecord => !!r && needsLabel(r));
      for (const id of ids) if (!recs.some((r) => r.id === id)) finish('label', id);
      if (recs.length === 0) return 'quick';
      const t0 = performance.now();
      let res;
      try {
        res = await aiApi.labelBatch(recs.map((r) => ({ id: r.id, title: r.title, from: r.from, preview: r.preview, kind: r.kind })), dataClass, { signal, priority: 'background' });
      } catch (e) {
        if (isAbort(e) || signal.aborted) {
          for (const r of recs) lists.label.front(r.id);
          return 'quick';
        }
        if (recs.length > 1 && (attempts.get(key('label', recs[0]?.id ?? '')) ?? 0) >= 2) {
          for (const r of recs) attempts.set(key('label', r.id), 3);
          for (const r of recs) lists.label.front(r.id);
          return 'ran';
        }
        await failed('label', recs.map((r) => r.id), signal);
        return 'ran';
      }
      const ms = performance.now() - t0;
      costs.label.observe(recs.length, ms);
      const pv = aiApi.promptVersions().label;
      for (const r of recs) {
        const label = res.labels[r.id];
        if (!label || !CATEGORIES.includes(label)) {
          await failed('label', [r.id], signal);
          continue;
        }
        const by = res.by?.[r.id] ?? res.trace.where;
        const { outcome, record } = await writeIfCurrentDetailed(db, r.id, r.version, (cur) => {
          let category: Category = label;
          let categoryBy: IndexRecord['categoryBy'] = by;
          let confidence = res.confidence?.[r.id];
          if (category !== 'Health' && aiApi.isHealthStrong({ title: cur.title, from: cur.from, preview: cur.preview })) {
            category = 'Health';
            categoryBy = 'rule';
            confidence = 'low';
          }
          const attemptsSoFar = (cur.enrich?.label?.attempts ?? 0) + 1;
          return {
            category, categoryBy,
            enrich: { ...cur.enrich, label: { v: pv, by, ...(res.sdk ? { sdk: res.sdk } : {}), at: Date.now(), ms: Math.round(ms / recs.length), ...(confidence ? { confidence } : {}), attempts: attemptsSoFar } },
          };
        });
        finish('label', r.id);
        if (outcome === 'ok' && record) {
          applyRecordInMemory(db, record);
          if (record.category !== r.category) classify(record, 'normal');
        }
      }
      return 'ran';
    } finally {
      for (const id of ids) inflight.label.delete(id);
      emit();
    }
  };

  // ---------- caption ----------

  const captionOnce = async (signal: AbortSignal): Promise<JobResult> => {
    if (lists.caption.size === 0 || captionBlock() !== null) return 'none';
    const nano = await aiApi.nano();
    const ids = lists.caption.ids();
    let chosen: string | null = null;
    let why: QueueProgress['waiting'] = 'model';
    for (const id of ids) {
      const m = rt.meta.get(id);
      if (!m) {
        chosen = id;
        break;
      }
      if (dataClassOf(db, m) === 'sample' || nano.image === 'available') {
        chosen = id;
        break;
      }
      if (await db.consents.get(id)) {
        chosen = id;
        break;
      }
      why = 'consent';
    }
    if (!chosen) {
      waiting.caption = nano.image === 'available' ? why : 'model';
      return 'none';
    }
    waiting.caption = null;
    lists.caption.remove(chosen);
    inflight.caption.add(chosen);
    try {
      const rec = await db.records.get(chosen);
      if (!rec || !needsCaption(rec)) {
        finish('caption', chosen);
        return 'quick';
      }
      let blob: Blob;
      try {
        const { getPhotoBlob } = await import('../../sources/photos/image');
        blob = await getPhotoBlob(db, rec.id);
      } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === 'PermissionNeededError' || name === 'NotAllowedError' || name === 'SecurityError') {
          lists.caption.add(rec.id, 'normal');
          waiting.caption = 'permission';
          return 'none';
        }
        finish('caption', rec.id);
        return 'quick';
      }
      const t0 = performance.now();
      captionsRun++;
      let res;
      try {
        res = await aiApi.captionPhoto(blob, dataClassOf(db, rec), { recordId: rec.id, priority: 'background', signal });
      } catch (e) {
        if (isAbort(e) || signal.aborted) {
          captionsRun--;
          lists.caption.front(rec.id);
          return 'quick';
        }
        await failed('caption', [rec.id], signal);
        return 'ran';
      }
      if (!res.ok) {
        const code = res.error.code;
        if (code === 'aborted') {
          captionsRun--;
          lists.caption.front(rec.id);
          return 'quick';
        }
        if (code === 'unavailable' || code === 'downloading' || code === 'needs-consent' || code === 'cloud-not-allowed') {
          captionsRun--;
          lists.caption.add(rec.id, 'normal');
          waiting.caption = code === 'needs-consent' || code === 'cloud-not-allowed' ? 'consent' : 'model';
          return 'none';
        }
        await failed('caption', [rec.id], signal);
        return 'ran';
      }
      const ms = performance.now() - t0;
      costs.caption.observe(1, ms);
      const caption = res.value.caption;
      const where = res.trace.where;
      const sdk = res.trace.sdkReported;
      const { outcome, record } = await writeIfCurrentDetailed(db, rec.id, rec.version, (cur) => {
        const patch: Partial<IndexRecord> = {
          caption, captionBy: where,
          enrich: { ...cur.enrich, caption: { v: aiApi.promptVersions().caption, by: where, ...(sdk ? { sdk } : {}), at: Date.now(), ms: Math.round(ms), attempts: (cur.enrich?.caption?.attempts ?? 0) + 1 } },
        };
        if (isPhotoPlaceholder(cur.preview) || cur.preview === cur.caption) patch.preview = cutGraphemes(caption, PREVIEW_CHARS);
        if (cur.category !== 'Health' && aiApi.isHealthStrong({ title: cur.title, from: cur.from, preview: caption })) {
          patch.category = 'Health';
          patch.categoryBy = 'rule';
        }
        return patch;
      });
      finish('caption', rec.id);
      if (outcome === 'ok' && record) {
        applyRecordInMemory(db, record);
        classify(record, 'high');
      }
      return 'ran';
    } finally {
      inflight.caption.delete(chosen);
      emit();
    }
  };

  // ---------- embed ----------

  const embedOnce = async (signal: AbortSignal): Promise<JobResult> => {
    if (lists.embed.size === 0) return 'none';
    const ml = getMl();
    const st = ml.status('embed');
    if (st.state !== 'ready') {
      // wait for the worker without holding the loop; the status subscription wakes it when the model is ready
      waiting.embed = 'model';
      if (st.state === 'idle') ml.warmup('embed').catch(() => undefined);
      return 'none';
    }
    waiting.embed = null;
    // pack records until EMBED_BATCH texts (a record with more inputs runs alone, in several calls)
    const picked: { rec: IndexRecord; plan: ReturnType<typeof embedTexts> }[] = [];
    let texts = 0;
    while (lists.embed.size > 0 && texts < EMBED_BATCH) {
      const [id] = lists.embed.take(1);
      if (!id) break;
      const rec = await db.records.get(id);
      if (!rec) {
        finish('embed', id);
        continue;
      }
      const plan = embedTexts(rec, ruleOf(rec));
      if (!needsEmbed(rec)) {
        finish('embed', id);
        continue;
      }
      if (picked.length > 0 && texts + plan.inputs.length > EMBED_BATCH) {
        lists.embed.front(id);
        break;
      }
      inflight.embed.add(id);
      picked.push({ rec, plan });
      texts += plan.inputs.length;
    }
    if (picked.length === 0) return lists.embed.size > 0 ? 'quick' : 'none';
    try {
      const all = picked.flatMap((p) => p.plan.inputs);
      const vectors: Float32Array[] = [];
      const t0 = performance.now();
      try {
        for (let i = 0; i < all.length; i += EMBED_BATCH) {
          const out = await ml.run<EmbedInput, EmbedOutput>('embed', { texts: all.slice(i, i + EMBED_BATCH) }, { priority: 'background', signal });
          for (let r = 0; r < out.count; r++) vectors.push(new Float32Array(out.data.subarray(r * out.dims, (r + 1) * out.dims)));
        }
      } catch (e) {
        if (isAbort(e) || signal.aborted) {
          for (const p of picked) lists.embed.front(p.rec.id);
          return 'quick';
        }
        if (e instanceof MlUnavailableError) {
          for (const p of picked) lists.embed.add(p.rec.id, 'normal');
          waiting.embed = 'model';
          return 'none';
        }
        if (picked.length > 1) {
          for (const p of picked) lists.embed.front(p.rec.id);
          await sleep(STAGE_RETRY_DELAYS_MS[0] ?? 2_000, signal);
          return 'ran';
        }
        await failed('embed', picked.map((p) => p.rec.id), signal);
        return 'ran';
      }
      const ms = performance.now() - t0;
      costs.embed.observe(all.length, ms);
      chunksPerRecord = 0.8 * chunksPerRecord + 0.2 * (all.length / picked.length);
      let offset = 0;
      for (const { rec, plan } of picked) {
        const mine = vectors.slice(offset, offset + plan.inputs.length);
        offset += plan.inputs.length;
        const rows: VectorRow[] = plan.chunks.map((c, i) => ({
          id: `${rec.id}#${c.n}`, recordId: rec.id, start: c.start, end: c.end,
          vector: mine[i] ?? new Float32Array(EMBEDDING_DIMS), model: EMBEDDING_MODEL, recordVersion: rec.version, inputHash: plan.sourceHash,
        }));
        const { outcome } = await writeIfCurrentDetailed(
          db, rec.id, rec.version,
          (cur) => (embedTexts(cur, ruleOf(cur)).sourceHash === plan.sourceHash ? {} : null),
          async () => {
            await db.vectors.where('recordId').equals(rec.id).delete();
            if (rows.length > 0) await db.vectors.bulkPut(rows);
          },
        );
        finish('embed', rec.id);
        if (outcome === 'ok') {
          rt.vectors.upsertRecord(rec.id, rows);
        } else if (outcome === 'stale') {
          const cur = await db.records.get(rec.id);
          if (cur && needsEmbed(cur)) add('embed', rec.id, 'normal');
        }
      }
      return 'ran';
    } finally {
      for (const p of picked) inflight.embed.delete(p.rec.id);
      emit();
    }
  };

  // ---------- privacy ----------

  /** Scans one record when its scan is not current; `scanned` says whether 11's scan ran. */
  const scanOne = async (id: string, signal: AbortSignal): Promise<{ record: IndexRecord | undefined; scanned: boolean }> => {
    const api = privacyScanApi();
    const rec = await db.records.get(id);
    if (!api || !rec) return { record: rec, scanned: false };
    const data = dataClassOf(db, rec);
    const rule = ruleOf(rec);
    const expected = await api.expectedStages(rec, data, rule);
    if (api.isScanCurrent(rec, expected)) return { record: rec, scanned: false };
    const { patch } = await api.scanRecord(rec, data, { rule, signal });
    const { outcome, record } = await writeIfCurrentDetailed(db, id, rec.version, () => ({ pii: patch.pii, injection: patch.injection, privacyScan: patch.privacyScan }));
    if (outcome === 'ok' && record) {
      applyRecordInMemory(db, record);
      return { record, scanned: true };
    }
    return { record: await db.records.get(id), scanned: true };
  };

  const privacyOnce = async (signal: AbortSignal): Promise<JobResult> => {
    if (lists.privacy.size === 0 || !privacyScanApi()) return 'none';
    const [id] = lists.privacy.take(1);
    if (!id) return 'none';
    const controller = new AbortController();
    const onStop = () => controller.abort();
    signal.addEventListener('abort', onStop, { once: true });
    let resolveDone!: () => void;
    privacyRunning = { id, controller, done: new Promise<void>((r) => (resolveDone = r)) };
    inflight.privacy.add(id);
    emitPrivacy();
    let result: JobResult = 'quick';
    try {
      const { scanned } = await scanOne(id, controller.signal);
      finish('privacy', id);
      if (scanned) result = 'ran';
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) {
        if (!signal.aborted && rt.meta.has(id)) lists.privacy.front(id);
      } else {
        console.warn('privacy scan failed for one item');
        await failed('privacy', [id], signal);
        result = 'ran';
      }
    } finally {
      signal.removeEventListener('abort', onStop);
      inflight.privacy.delete(id);
      privacyRunning = null;
      resolveDone();
      emitPrivacy();
    }
    return result;
  };

  const privacyStatus = (): ScanQueueStatus => ({ queued: lists.privacy.size, running: privacyRunning?.id, done: privacyDone, paused });

  /** Checks the records seen before 11's scan functions loaded, and queues the stale ones. */
  const drainPrivacyUnchecked = async () => {
    const ids = [...privacyUnchecked];
    privacyUnchecked.clear();
    if (ids.length === 0 || !privacyScanApi()) return;
    for (let i = 0; i < ids.length; i += 500) {
      const recs = await db.records.bulkGet(ids.slice(i, i + 500)).catch(() => [] as (IndexRecord | undefined)[]);
      for (const rec of recs) if (rec) addPrivacy(rec, 'normal');
    }
  };

  // ---------- the loop ----------

  /** Battery, the override or the captions switch changed: recount the progress and let the loop look again. */
  const onConditions = () => {
    emit();
    emitPrivacy();
    wake();
    checkIdle();
  };

  const runOnce = (lane: Lane, signal: AbortSignal): Promise<JobResult> => {
    if (lane === 'label') return labelOnce(signal);
    if (lane === 'embed') return embedOnce(signal);
    if (lane === 'privacy') return privacyOnce(signal);
    return captionOnce(signal);
  };

  const buildBacklog = async () => {
    const ids = (await db.records.orderBy('date').reverse().primaryKeys()) as string[];
    for (let i = 0; i < ids.length; i += 500) {
      const recs = await db.records.bulkGet(ids.slice(i, i + 500));
      for (const rec of recs) if (rec) classify(rec, 'normal');
    }
    backlogBuilt = true;
    emit();
    wake();
    checkIdle();
  };

  const queue: IngestQueue = {
    start() {
      if (running) return;
      running = true;
      stopController = new AbortController();
      const signal = stopController.signal;
      rt.queue = { enqueue, cancel, pause: () => queue.pause(), stop: () => queue.stop(), writeRowsNow: () => writeSourceRows() };
      conditionListeners.set(db, onConditions);
      unsubNano = aiApi.subscribeNano(() => {
        waiting.label = null;
        waiting.caption = null;
        wake();
      });
      unsubMl = getMl().subscribe((task, s) => {
        if (task === 'embed' && s.state === 'ready') {
          waiting.embed = null;
          wake();
        }
      });
      loop = runSerial({
        signal,
        held,
        runnable,
        urgent: (lane) => lists[lane].hasUrgent(),
        run: runOnce,
        waitForWork: () => waitForWork(),
        onJob: (lane) => {
          current = lane;
          if (lane === null) {
            emit();
            checkIdle();
          }
        },
      });
      void loadPrivacyScanApi()
        .then(async (api) => {
          if (running && api?.onPrivacyModelStatus) {
            unsubPrivacyModel = api.onPrivacyModelStatus(() => {
              emit();
              wake();
              checkIdle();
            });
          }
          if (api?.getPrivacyModelStatus?.().state === 'idle') void api.warmupPrivacyModel?.().catch(() => undefined);
          enqueuing++;
          try {
            await drainPrivacyUnchecked();
          } finally {
            enqueuing--;
          }
        })
        .catch(() => undefined)
        .finally(() => {
          privacyLoaded = true;
          emit();
          wake();
          checkIdle();
        });
      void buildBacklog();
    },
    async stop() {
      if (!running) return;
      running = false;
      stopController.abort();
      wake();
      unsubNano?.();
      unsubMl?.();
      unsubPrivacyModel?.();
      unsubNano = null;
      unsubMl = null;
      unsubPrivacyModel = null;
      if (conditionListeners.get(db) === onConditions) conditionListeners.delete(db);
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = null;
      await (loop ?? Promise.resolve()).catch(() => undefined);
      loop = null;
      for (const l of Object.values(lists)) l.clear();
      privacyUnchecked.clear();
      urgentEmbeds.clear();
      const flushing = flushWaiters;
      flushWaiters = [];
      for (const w of flushing) w();
      if (rt.queue?.enqueue === enqueue) rt.queue = null;
      const ws = idleWaiters;
      idleWaiters = [];
      for (const w of ws) w();
    },
    enqueue,
    cancel,
    pause() {
      paused = true;
      privacyRunning?.controller.abort();
      emit();
      emitPrivacy();
    },
    resume() {
      paused = false;
      emit();
      emitPrivacy();
      wake();
    },
    setCategoryRules(next) {
      rules = { ...next };
      void (async () => {
        await db.records.each((rec) => {
          if (needsCaption(rec)) add('caption', rec.id, 'normal');
          if (needsEmbed(rec)) add('embed', rec.id, 'normal');
        });
        privacyApiRefresh();
        emit();
        wake();
      })();
    },
    progress: snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    whenIdle() {
      return new Promise<void>((resolve) => {
        if (isIdle()) return resolve();
        idleWaiters.push(() => {
          if (isIdle()) resolve();
          else void queue.whenIdle().then(resolve);
        });
      });
    },
    pendingBySource,
    flushUrgent(timeoutMs = URGENT_FLUSH_MS, signal) {
      return new Promise((resolve) => {
        if (urgentSettled()) return resolve('done');
        if (!running || held() || waiting.embed !== null) return resolve('skipped');
        let settled = false;
        const end = (r: 'done' | 'timeout') => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          flushWaiters = flushWaiters.filter((w) => w !== waiter);
          signal?.removeEventListener('abort', onAbort);
          resolve(r);
        };
        const waiter = () => end('done');
        const onAbort = () => end('timeout');
        const timer = setTimeout(() => end('timeout'), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        flushWaiters.push(waiter);
        wake();
      });
    },
    get privacy() {
      return privacy;
    },
    get paused() {
      return paused;
    },
  };

  /** Every record again (a rule change, refreshAll): the stale ones go back on the privacy lane. */
  const privacyApiRefresh = () => {
    enqueuing++;
    void (async () => {
      try {
        await db.records.orderBy('date').reverse().each((rec) => addPrivacy(rec, 'normal'));
      } catch {
        // the database is closing
      } finally {
        enqueuing--;
        emitPrivacy();
        wake();
        checkIdle();
      }
    })();
  };

  const privacy: PrivacyScanQueue = {
    start() {
      queue.start();
    },
    pause() {
      queue.pause();
    },
    resume() {
      queue.resume();
    },
    stop() {
      void queue.stop();
    },
    enqueue(ids) {
      for (const id of ids) add('privacy', id, 'normal');
      emitPrivacy();
      wake();
    },
    async scanNow(id, signal) {
      if (privacyRunning?.id === id) {
        await privacyRunning.done;
        return db.records.get(id);
      }
      if (privacyRunning) privacyRunning.controller.abort();   // it goes back to the front of the background list
      if (lists.privacy.remove(id)) finish('privacy', id);
      const controller = new AbortController();
      signal?.addEventListener('abort', () => controller.abort(), { once: true });
      try {
        return (await scanOne(id, controller.signal)).record;
      } finally {
        wake();
      }
    },
    refreshAll() {
      privacyApiRefresh();
    },
    status: privacyStatus,
    onChange(cb) {
      privacyListeners.add(cb);
      return () => {
        privacyListeners.delete(cb);
      };
    },
  };

  return queue;
}
