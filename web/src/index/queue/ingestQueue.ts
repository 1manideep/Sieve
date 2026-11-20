// The one background queue (01 section 11.1, 20 section 13): label and caption (Nano lane), embed (ML lane) and the
// privacy scan (11's scanRecord), newest first, versioned writes, pausable, progress and ETA. Questions go first:
// 10's scheduler preempts background Nano calls and the ML worker serves foreground jobs first.
import { CATEGORIES, DEFAULT_CATEGORY_RULES, EMBEDDING_DIMS, EMBEDDING_MODEL, PREVIEW_CHARS } from '@sieve/shared';
import type { Category, CategoryRule, IndexRecord, SourceKind } from '@sieve/shared';
import { getMl, MlUnavailableError } from '../../ml/client';
import type { EmbedInput, EmbedOutput } from '../../ml/protocol';
import { embedTexts } from '../chunk';
import { EMBED_BATCH, LABEL_BATCH_SIZE, QUEUE_IDLE_RECHECK_MS, SOURCE_ROW_WRITE_MS, STAGE_RETRY_DELAYS_MS } from '../config';
import { applyRecordInMemory, writeIfCurrentDetailed } from '../consistency';
import { dataClassOf, type SieveDb, type VectorRow } from '../db';
import { aiApi, loadPrivacyScanApi, privacyScanApi } from '../deps';
import { isPhotoPlaceholder } from '../preview';
import { getRuntime } from '../runtime';
import { cutGraphemes } from '../text';
import { overallEtaMs, priorCosts, type QueueStage } from './eta';

export interface QueueProgress {
  stage: QueueStage; done: number; total: number;
  waiting: null | 'model' | 'consent' | 'permission' | 'paused'; secPerItem: number; etaMs: number;
}

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
  readonly privacy: PrivacyScanQueue;
  readonly paused: boolean;
}

type Lane = 'nano' | 'ml' | 'privacy';
type Stage = QueueStage | 'privacy';

/** Newest first; high priority at the front. */
class StageList {
  private high: string[] = [];
  private normal: string[] = [];
  private members = new Set<string>();
  constructor(private readonly dateOf: (id: string) => number) {}
  get size(): number {
    return this.members.size;
  }
  has(id: string): boolean {
    return this.members.has(id);
  }
  add(id: string, priority: 'normal' | 'high'): boolean {
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
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function yieldToIdle(): Promise<void> {
  const sched = (globalThis as unknown as { scheduler?: { postTask?: (cb: () => void, o: { priority: string }) => Promise<void> } }).scheduler;
  if (typeof sched?.postTask === 'function') return sched.postTask(() => undefined, { priority: 'background' });
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string })?.name === 'AbortError' || (e as { code?: string })?.code === 'aborted';
}

const queues = new Map<SieveDb, IngestQueue>();

/** The queue of a database, if started. */
export function peekQueue(db: SieveDb): IngestQueue | undefined {
  return queues.get(db);
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
  const totals: Record<QueueStage, { done: number; total: number }> = { label: { done: 0, total: 0 }, caption: { done: 0, total: 0 }, embed: { done: 0, total: 0 } };
  const waiting: Record<QueueStage, QueueProgress['waiting']> = { label: null, caption: null, embed: null };
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
  let lanes: Promise<void>[] = [];
  let stopController = new AbortController();
  const wakers: Record<Lane, (() => void) | null> = { nano: null, ml: null, privacy: null };
  // A wake that arrives while a lane is working, or between its last empty check and its sleep (an await apart),
  // is kept here, so the lane's next sleep ends at once instead of waiting out QUEUE_IDLE_RECHECK_MS.
  const wakePending: Record<Lane, boolean> = { nano: false, ml: false, privacy: false };
  const busy: Record<Lane, boolean> = { nano: false, ml: false, privacy: false };
  let idleWaiters: (() => void)[] = [];
  let unsubNano: (() => void) | null = null;
  let unsubMl: (() => void) | null = null;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let backlogBuilt = false;
  let enqueuing = 0;
  let privacyLoaded = false;

  const key = (stage: Stage, id: string) => `${stage}:${id}`;

  const wake = (lane?: Lane) => {
    for (const l of lane ? [lane] : (Object.keys(wakers) as Lane[])) {
      const w = wakers[l];
      wakers[l] = null;
      if (w) w();
      else wakePending[l] = true;
    }
  };

  const waitForWork = (lane: Lane, ms = QUEUE_IDLE_RECHECK_MS) =>
    new Promise<void>((resolve) => {
      if (wakePending[lane]) {
        wakePending[lane] = false;
        resolve();
        return;
      }
      const t = setTimeout(() => {
        wakers[lane] = null;
        resolve();
      }, ms);
      wakers[lane] = () => {
        clearTimeout(t);
        resolve();
      };
      checkIdle();
    });

  const laneHasRunnable = (lane: Lane): boolean => {
    if (lane === 'nano') return (lists.label.size > 0 && waiting.label === null) || (lists.caption.size > 0 && waiting.caption === null);
    if (lane === 'ml') return lists.embed.size > 0 && waiting.embed === null;
    return lists.privacy.size > 0 && privacyScanApi() !== null;
  };

  const isIdle = () => enqueuing === 0 && (privacyLoaded || !running) && (backlogBuilt || !running) && (Object.keys(busy) as Lane[]).every((l) => !busy[l] && (paused || !laneHasRunnable(l)));

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
    (['label', 'caption', 'embed'] as QueueStage[]).map((stage) => {
      const t = totals[stage];
      const remaining = Math.max(0, t.total - t.done);
      const units = stage === 'embed' ? remaining * chunksPerRecord : remaining;
      return { stage, done: t.done, total: t.total, waiting: paused && remaining > 0 ? 'paused' : remaining > 0 ? waiting[stage] : null, secPerItem: costs[stage].secPerItem, etaMs: costs[stage].etaMs(units) };
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

  const pendingBySource = (): Map<SourceKind, number> => {
    const ids = new Set<string>();
    for (const stage of ['label', 'caption', 'embed'] as QueueStage[]) {
      for (const id of lists[stage].ids()) ids.add(id);
      for (const id of inflight[stage]) ids.add(id);
    }
    const out = new Map<SourceKind, number>();
    for (const id of ids) {
      const src = rt.meta.get(id)?.source ?? (id.split(':')[0] as SourceKind);
      out.set(src, (out.get(src) ?? 0) + 1);
    }
    return out;
  };

  const scheduleSourceRows = () => {
    if (progressTimer) return;
    progressTimer = setTimeout(() => {
      progressTimer = null;
      void writeSourceRows();
    }, SOURCE_ROW_WRITE_MS);
  };

  const writeSourceRows = async () => {
    if (db.sieveKind !== 'real') return;
    const pending = pendingBySource();
    const p = snapshot();
    const eta = overallEtaMs({ label: p[0]?.etaMs ?? 0, caption: p[1]?.etaMs ?? 0, embed: p[2]?.etaMs ?? 0 });
    try {
      const rows = await db.sources.toArray();
      for (const row of rows) {
        if (!row.connected || row.kind === 'playground') continue;
        const sync = rt.syncProgress.get(row.kind);
        let count = 0;
        for (const m of rt.meta.values()) if (m.source === row.kind) count++;
        const total = Math.max(count, sync?.discovered ?? 0);
        const left = (pending.get(row.kind) ?? 0) + (sync?.remaining ?? 0);
        const done = Math.max(0, total - left);
        const etaMs = (sync?.etaMs ?? 0) + (left > 0 ? eta : 0);
        if (row.progress.done !== done || row.progress.total !== total || row.etaMs !== etaMs) {
          await db.sources.update(row.kind, { progress: { done, total }, etaMs });
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

  const laneOf = (stage: Stage): Lane => (stage === 'embed' ? 'ml' : stage === 'privacy' ? 'privacy' : 'nano');

  const add = (stage: Stage, id: string, priority: 'normal' | 'high') => {
    if (skipped.has(key(stage, id))) return;
    const added = lists[stage].add(id, priority);
    if (added && stage !== 'privacy' && !inflight[stage].has(id)) totals[stage].total++;
    if (added) wake(laneOf(stage));   // a lane that is asleep picks it up now, not at the next recheck
  };

  const finish = (stage: Stage, _id: string) => {
    if (stage === 'privacy') {
      privacyDone++;
      emitPrivacy();
      return;
    }
    totals[stage].done = Math.min(totals[stage].total, totals[stage].done + 1);
  };

  const classify = (rec: IndexRecord, priority: 'normal' | 'high') => {
    if (needsLabel(rec)) add('label', rec.id, priority);
    if (needsCaption(rec)) add('caption', rec.id, priority);
    if (needsEmbed(rec)) add('embed', rec.id, priority);
    add('privacy', rec.id, priority);
  };

  const enqueue = (ids: string[], opts?: { priority?: 'normal' | 'high' }) => {
    if (ids.length === 0) return;
    const priority = opts?.priority ?? 'normal';
    enqueuing++;
    void (async () => {
      try {
        const recs = await db.records.bulkGet(ids).catch(() => [] as (IndexRecord | undefined)[]);
        for (const rec of recs) if (rec) classify(rec, priority);
      } finally {
        enqueuing--;
        emit();
        wake();
        checkIdle();
      }
    })();
  };

  const cancel = (ids: string[]) => {
    for (const id of ids) {
      for (const stage of ['label', 'caption', 'embed', 'privacy'] as Stage[]) {
        if (lists[stage].remove(id)) finish(stage, id);
      }
      for (const s of ['label', 'caption', 'embed', 'privacy'] as Stage[]) for (const k of [...attempts.keys()]) if (k === key(s, id)) attempts.delete(k);
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

  const labelOnce = async (signal: AbortSignal): Promise<boolean> => {
    if (lists.label.size === 0) return false;
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
      return false;
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
      if (recs.length === 0) return true;
      const t0 = performance.now();
      let res;
      try {
        res = await aiApi.labelBatch(recs.map((r) => ({ id: r.id, title: r.title, from: r.from, preview: r.preview, kind: r.kind })), dataClass, { signal, priority: 'background' });
      } catch (e) {
        if (isAbort(e) || signal.aborted) {
          for (const r of recs) lists.label.front(r.id);
          return true;
        }
        if (recs.length > 1 && (attempts.get(key('label', recs[0]?.id ?? '')) ?? 0) >= 2) {
          for (const r of recs) attempts.set(key('label', r.id), 3);
          for (const r of recs) lists.label.front(r.id);
          return true;
        }
        await failed('label', recs.map((r) => r.id), signal);
        return true;
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
      return true;
    } finally {
      for (const id of ids) inflight.label.delete(id);
      emit();
    }
  };

  // ---------- caption ----------

  const captionOnce = async (signal: AbortSignal): Promise<boolean> => {
    if (lists.caption.size === 0) return false;
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
      return false;
    }
    waiting.caption = null;
    lists.caption.remove(chosen);
    inflight.caption.add(chosen);
    try {
      const rec = await db.records.get(chosen);
      if (!rec || !needsCaption(rec)) {
        finish('caption', chosen);
        return true;
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
          return false;
        }
        finish('caption', rec.id);
        return true;
      }
      const t0 = performance.now();
      let res;
      try {
        res = await aiApi.captionPhoto(blob, dataClassOf(db, rec), { recordId: rec.id, priority: 'background', signal });
      } catch (e) {
        if (isAbort(e) || signal.aborted) {
          lists.caption.front(rec.id);
          return true;
        }
        await failed('caption', [rec.id], signal);
        return true;
      }
      if (!res.ok) {
        const code = res.error.code;
        if (code === 'aborted') {
          lists.caption.front(rec.id);
          return true;
        }
        if (code === 'unavailable' || code === 'downloading' || code === 'needs-consent' || code === 'cloud-not-allowed') {
          lists.caption.add(rec.id, 'normal');
          waiting.caption = code === 'needs-consent' || code === 'cloud-not-allowed' ? 'consent' : 'model';
          return false;
        }
        await failed('caption', [rec.id], signal);
        return true;
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
      return true;
    } finally {
      inflight.caption.delete(chosen);
      emit();
    }
  };

  // ---------- embed ----------

  const embedOnce = async (signal: AbortSignal): Promise<boolean> => {
    if (lists.embed.size === 0) return false;
    const ml = getMl();
    const st = ml.status('embed');
    if (st.state !== 'ready') {
      // wait for the worker without holding the lane; the status subscription wakes it when the model is ready
      waiting.embed = 'model';
      if (st.state === 'idle') ml.warmup('embed').catch(() => undefined);
      return false;
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
    if (picked.length === 0) return lists.embed.size > 0;
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
          return true;
        }
        if (e instanceof MlUnavailableError) {
          for (const p of picked) lists.embed.add(p.rec.id, 'normal');
          waiting.embed = 'model';
          return false;
        }
        if (picked.length > 1) {
          for (const p of picked) lists.embed.front(p.rec.id);
          await sleep(STAGE_RETRY_DELAYS_MS[0] ?? 2_000, signal);
          return true;
        }
        await failed('embed', picked.map((p) => p.rec.id), signal);
        return true;
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
      return true;
    } finally {
      for (const p of picked) inflight.embed.delete(p.rec.id);
      emit();
    }
  };

  // ---------- privacy ----------

  const scanOne = async (id: string, signal: AbortSignal): Promise<IndexRecord | undefined> => {
    const api = privacyScanApi();
    const rec = await db.records.get(id);
    if (!api || !rec) return rec;
    const data = dataClassOf(db, rec);
    const rule = ruleOf(rec);
    const expected = await api.expectedStages(rec, data, rule);
    if (api.isScanCurrent(rec, expected)) return rec;
    const { patch } = await api.scanRecord(rec, data, { rule, signal });
    const { outcome, record } = await writeIfCurrentDetailed(db, id, rec.version, () => ({ pii: patch.pii, injection: patch.injection, privacyScan: patch.privacyScan }));
    if (outcome === 'ok' && record) {
      applyRecordInMemory(db, record);
      return record;
    }
    return db.records.get(id);
  };

  const privacyOnce = async (signal: AbortSignal): Promise<boolean> => {
    if (lists.privacy.size === 0 || !privacyScanApi()) return false;
    const [id] = lists.privacy.take(1);
    if (!id) return false;
    const controller = new AbortController();
    const onStop = () => controller.abort();
    signal.addEventListener('abort', onStop, { once: true });
    let resolveDone!: () => void;
    privacyRunning = { id, controller, done: new Promise<void>((r) => (resolveDone = r)) };
    inflight.privacy.add(id);
    emitPrivacy();
    try {
      await scanOne(id, controller.signal);
      finish('privacy', id);
    } catch (e) {
      if (isAbort(e) || controller.signal.aborted) {
        if (!signal.aborted && rt.meta.has(id)) lists.privacy.front(id);
      } else {
        console.warn('privacy scan failed for one item');
        await failed('privacy', [id], signal);
      }
    } finally {
      signal.removeEventListener('abort', onStop);
      inflight.privacy.delete(id);
      privacyRunning = null;
      resolveDone();
      emitPrivacy();
    }
    return true;
  };

  const privacyStatus = (): ScanQueueStatus => ({ queued: lists.privacy.size, running: privacyRunning?.id, done: privacyDone, paused });

  // ---------- lanes ----------

  const runLane = async (lane: Lane, signal: AbortSignal) => {
    while (!signal.aborted) {
      if (paused) {
        await waitForWork(lane);
        continue;
      }
      busy[lane] = true;
      let worked = false;
      try {
        if (lane === 'nano') {
          worked = await labelOnce(signal);
          if (!worked && !signal.aborted && !paused) worked = await captionOnce(signal);
        } else if (lane === 'ml') {
          worked = await embedOnce(signal);
        } else {
          worked = await privacyOnce(signal);
        }
      } catch (e) {
        console.warn(`background ${lane} job failed`, String((e as Error)?.message ?? e).slice(0, 80));
      } finally {
        busy[lane] = false;
      }
      emit();
      if (signal.aborted) break;
      if (worked) await yieldToIdle();
      else await waitForWork(lane);
    }
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
      rt.queue = { enqueue, cancel, pause: () => queue.pause(), stop: () => queue.stop() };
      unsubNano = aiApi.subscribeNano(() => {
        waiting.label = null;
        waiting.caption = null;
        for (const id of lists.privacy.ids()) lists.privacy.front(id);
        privacyApiRefresh();
        wake();
      });
      unsubMl = getMl().subscribe((task, s) => {
        if (task === 'embed' && s.state === 'ready') {
          waiting.embed = null;
          wake('ml');
        }
      });
      lanes = (['nano', 'ml', 'privacy'] as Lane[]).map((l) => runLane(l, signal));
      void loadPrivacyScanApi().finally(() => {
        privacyLoaded = true;
        wake('privacy');
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
      unsubNano = null;
      unsubMl = null;
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = null;
      await Promise.allSettled(lanes);
      lanes = [];
      for (const l of Object.values(lists)) l.clear();
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
    get privacy() {
      return privacy;
    },
    get paused() {
      return paused;
    },
  };

  const privacyApiRefresh = () => {
    void (async () => {
      const ids = (await db.records.orderBy('date').reverse().primaryKeys()) as string[];
      for (const id of ids) add('privacy', id, 'normal');
      emitPrivacy();
      wake('privacy');
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
      wake('privacy');
    },
    async scanNow(id, signal) {
      if (privacyRunning?.id === id) {
        await privacyRunning.done;
        return db.records.get(id);
      }
      if (privacyRunning) privacyRunning.controller.abort();   // it goes back to the front of the background list
      lists.privacy.remove(id);
      const controller = new AbortController();
      signal?.addEventListener('abort', () => controller.abort(), { once: true });
      try {
        return await scanOne(id, controller.signal);
      } finally {
        wake('privacy');
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
