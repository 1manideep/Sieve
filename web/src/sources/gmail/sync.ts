// Gmail sync (20 sections 15.4 to 15.6): backfill (metadata, then bodies), incremental history, and the full id
// reconciliation that catches deletions when history has expired. All writes go through ingestInternal and
// removeRecords, so they follow the consistency rules of 01 section 10.
import type { IndexRecord } from '@sieve/shared';
import {
  GMAIL_BACKFILL_QUERY, GMAIL_BODY_BACKFILL_MAX, GMAIL_COST, GMAIL_LIST_PAGE, GMAIL_MAX_CONCURRENCY, GMAIL_RECONCILE_EVERY_MS,
  GMAIL_RECONCILE_QUERY, GMAIL_SYNC_INTERVAL_MS, GMAIL_UNITS_PER_MINUTE, SOURCE_ROW_WRITE_MS,
} from '../../index/config';
import { emailContentHash, removeRecords } from '../../index/consistency';
import type { RemoveReason, SieveDb, SourceRow } from '../../index/db';
import { IngestError, ingestInternal } from '../../index/ingest';
import { isLeader } from '../../index/locks';
import { getRuntime } from '../../index/runtime';
import { SOURCE_COPY } from '../types';
import { getGmailToken } from './auth';
import { loadStoredGmailToken } from './tokenStore';
import {
  GmailAuthError, GmailForbiddenError, GmailNetworkError, GmailNotFoundError, GmailRateError,
  getMessage, getProfile, listHistory, listMessages, type GmailMessage,
} from './api';
import { decodeSnippet, extractBodies, header, isSkippable, isTrashed } from './mime';

export class SyncStopped extends Error {
  constructor(readonly why: 'paused' | 'no-token' | 'aborted') {
    super(why);
    this.name = 'SyncStopped';
  }
}

/** A message as a RawItem plus its hash (20 section 5.2). */
export async function rawFromMessage(msg: GmailMessage, phase: 'meta' | 'full') {
  const subject = header(msg.payload, 'Subject') ?? '';
  const from = header(msg.payload, 'From');
  const internalDate = Number(msg.internalDate) || Date.now();
  let html: string | undefined;
  let text: string | undefined;
  if (phase === 'meta') {
    text = decodeSnippet(msg.snippet ?? '');
  } else {
    const b = msg.payload ? extractBodies(msg.payload) : { attachments: 0 };
    html = b.html;
    text = b.html ? undefined : b.text ?? '';
  }
  const contentHash = await emailContentHash({ id: msg.id, subject, from, internalDate, html, text, phase });
  return {
    raw: { source: 'gmail' as const, sourceRef: msg.id, kind: 'email' as const, title: subject, from, threadId: msg.threadId, date: internalDate, html, text },
    contentHash, internalDate, sizeBytes: msg.sizeEstimate,
  };
}

interface Ctl { signal: AbortSignal; isPaused: () => boolean }

function boundary(ctl: Ctl): void {
  if (ctl.signal.aborted) throw new SyncStopped('aborted');
  if (ctl.isPaused()) throw new SyncStopped('paused');
  if (!getGmailToken()) throw new SyncStopped('no-token');
}

async function listAll(q: string, ctl: Ctl, onPage?: (found: number) => void): Promise<{ id: string; threadId: string }[]> {
  const out: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  do {
    boundary(ctl);
    const page = await listMessages(q, pageToken, GMAIL_LIST_PAGE, 'background', ctl.signal);
    out.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
    onPage?.(out.length);
  } while (pageToken);
  return out;
}

class RowWriter {
  private last = 0;
  private pendingPatch: Partial<SourceRow> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly db: SieveDb) {}
  set(patch: Partial<SourceRow>, now = false): Promise<void> | void {
    Object.assign(this.pendingPatch, patch);
    if (now || Date.now() - this.last >= SOURCE_ROW_WRITE_MS) return this.flush();
    this.timer ??= setTimeout(() => void this.flush(), SOURCE_ROW_WRITE_MS);
  }
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const patch = this.pendingPatch;
    this.pendingPatch = {};
    this.last = Date.now();
    if (Object.keys(patch).length === 0) return;
    try {
      await this.db.sources.update('gmail', patch);
    } catch {
      // closing
    }
  }
}

async function runPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  let firstError: unknown = null;
  const worker = async () => {
    while (i < items.length && !firstError) {
      const item = items[i++] as T;
      try {
        await fn(item);
      } catch (e) {
        firstError ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (firstError) throw firstError;
}

function etaMs(remaining: number, units: number): number {
  return Math.round((remaining * units * 60_000) / GMAIL_UNITS_PER_MINUTE);
}

async function ingestMessage(db: SieveDb, msg: GmailMessage, phase: 'meta' | 'full', account: string | undefined, notTombstonedSince?: number): Promise<IndexRecord | null> {
  if (isSkippable(msg)) return null;
  const r = await rawFromMessage(msg, phase);
  try {
    return await ingestInternal(db, r.raw, 'own', {
      bodyPending: phase === 'meta', sizeBytes: r.sizeBytes, sourceModifiedAt: r.internalDate, contentHash: r.contentHash,
      ownAddress: account, notTombstonedSince, deferSave: true,
    });
  } catch (e) {
    if (e instanceof IngestError && e.code !== 'storage-full') return null;   // skip the item, keep the job (70 P2)
    throw e;
  }
}

/** Metadata for unknown ids, then bodies for the newest records without text (20 section 15.4). */
export async function backfill(db: SieveDb, ctl: Ctl): Promise<void> {
  const rt = getRuntime(db);
  const row = await db.sources.get('gmail');
  const account = row?.account;
  const jobStartedAt = Date.now();
  const writer = new RowWriter(db);
  await writer.set({ phase: 'listing' }, true);
  // While listing, the total only grows and the card says "so far"; the queue alone writes the row's progress, so
  // the card never alternates between the fetch count and the index count (20 section 13.4).
  const stored = await db.records.where('source').equals('gmail').count();
  const listed = await listAll(GMAIL_BACKFILL_QUERY, ctl, (found) => {
    rt.syncProgress.set('gmail', { discovered: found, remaining: Math.max(0, found - stored), listing: true });
    void rt.queue?.writeRowsNow?.();
  });
  const known = await db.records.bulkGet(listed.map((m) => 'gmail:' + m.id));
  const todo = listed.filter((_, i) => !known[i]);
  let remaining = todo.length;
  rt.syncProgress.set('gmail', { discovered: listed.length, remaining, etaMs: etaMs(remaining, GMAIL_COST.get) });
  await writer.set({ phase: 'metadata', inventory: { emails: remaining } }, true);
  await rt.queue?.writeRowsNow?.();
  await runPool(todo, GMAIL_MAX_CONCURRENCY, async (m) => {
    boundary(ctl);
    try {
      const msg = await getMessage(m.id, 'metadata', 'background', ctl.signal);
      await ingestMessage(db, msg, 'meta', account, jobStartedAt);
    } catch (e) {
      if (!(e instanceof GmailNotFoundError)) throw e;
    }
    remaining--;
    rt.syncProgress.set('gmail', { discovered: listed.length, remaining, etaMs: etaMs(remaining, GMAIL_COST.get) });
  });
  await bodies(db, ctl, writer, account);
  await rt.keyword.flush();
  rt.syncProgress.delete('gmail');
  // a finished backfill starts from a complete listing, so it counts as the first reconciliation
  await writer.set({ phase: 'idle', lastSyncAt: Date.now(), reconciledAt: Date.now(), needsAuth: false, error: undefined, errorCode: undefined }, true);
}

async function bodies(db: SieveDb, ctl: Ctl, writer: RowWriter, account?: string): Promise<void> {
  const rt = getRuntime(db);
  const need: string[] = [];
  await db.records.where('source').equals('gmail').each((r) => {
    if (r.text === undefined) need.push(r.id);
  });
  need.sort((a, b) => (rt.meta.get(b)?.date ?? 0) - (rt.meta.get(a)?.date ?? 0));
  const todo = need.slice(0, GMAIL_BODY_BACKFILL_MAX);
  let remaining = todo.length;
  await writer.set({ phase: 'bodies' }, true);
  const discovered = rt.syncProgress.get('gmail')?.discovered ?? todo.length;
  await runPool(todo, GMAIL_MAX_CONCURRENCY, async (id) => {
    boundary(ctl);
    try {
      const msg = await getMessage(id.slice('gmail:'.length), 'full', 'background', ctl.signal);
      if (isTrashed(msg.labelIds)) await removeRecords(db, [id], 'trashed');
      else await ingestMessage(db, msg, 'full', account);
    } catch (e) {
      if (e instanceof GmailNotFoundError) await removeRecords(db, [id], 'source-deleted');
      else throw e;
    }
    remaining--;
    rt.syncProgress.set('gmail', { discovered, remaining, etaMs: etaMs(remaining, GMAIL_COST.getFull) });
  });
}

/** History since the cursor; 404 (expired) falls back to reconciliation (20 section 15.5). */
export async function incremental(db: SieveDb, ctl: Ctl): Promise<void> {
  const row = await db.sources.get('gmail');
  if (!row?.cursor) return backfill(db, ctl);
  const writer = new RowWriter(db);
  await writer.set({ phase: 'incremental' }, true);
  const jobStartedAt = Date.now();
  const state = new Map<string, 'added' | 'restored' | RemoveReason>();
  let cursor = row.cursor;
  let pageToken: string | undefined;
  try {
    do {
      boundary(ctl);
      const page = await listHistory(row.cursor, pageToken, ctl.signal);
      for (const h of page.history ?? []) {
        for (const a of h.messagesAdded ?? []) if (!isSkippable(a.message)) state.set(a.message.id, 'added');
        for (const d of h.messagesDeleted ?? []) state.set(d.message.id, 'source-deleted');
        for (const l of h.labelsAdded ?? []) if (l.labelIds.includes('TRASH') || l.labelIds.includes('SPAM')) state.set(l.message.id, 'trashed');
        for (const l of h.labelsRemoved ?? []) {
          if ((l.labelIds.includes('TRASH') || l.labelIds.includes('SPAM')) && !isTrashed(l.message.labelIds)) state.set(l.message.id, 'restored');
        }
      }
      cursor = page.historyId ?? cursor;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (e instanceof GmailNotFoundError) return reconcile(db, ctl);
    throw e;
  }
  const byReason = new Map<RemoveReason, string[]>();
  const fetch: { id: string; restored: boolean }[] = [];
  for (const [id, s] of state) {
    if (s === 'added' || s === 'restored') fetch.push({ id, restored: s === 'restored' });
    else byReason.set(s, [...(byReason.get(s) ?? []), 'gmail:' + id]);
  }
  for (const [reason, ids] of byReason) await removeRecords(db, ids, reason);
  await runPool(fetch, GMAIL_MAX_CONCURRENCY, async ({ id, restored }) => {
    boundary(ctl);
    try {
      const msg = await getMessage(id, 'full', 'background', ctl.signal);
      await ingestMessage(db, msg, 'full', row.account, restored ? undefined : jobStartedAt);
    } catch (e) {
      if (!(e instanceof GmailNotFoundError)) throw e;
    }
  });
  await getRuntime(db).keyword.flush();
  await writer.set({ cursor, phase: 'idle', lastSyncAt: Date.now(), needsAuth: false, error: undefined, errorCode: undefined }, true);
}

/** Full id reconciliation (20 section 15.6, 70 R-IDX-08). */
export async function reconcile(db: SieveDb, ctl: Ctl): Promise<void> {
  const writer = new RowWriter(db);
  await writer.set({ phase: 'reconciling' }, true);
  const row = await db.sources.get('gmail');
  boundary(ctl);
  const profile = await getProfile('background');
  const everything = new Set((await listAll(GMAIL_RECONCILE_QUERY, ctl)).map((m) => m.id));
  const stored = (await db.records.where('source').equals('gmail').primaryKeys()) as string[];
  const gone = stored.filter((id) => !everything.has(id.slice('gmail:'.length)));
  if (gone.length > 0) await removeRecords(db, gone, 'source-deleted');
  const windowIds = await listAll(GMAIL_BACKFILL_QUERY, ctl);
  const known = await db.records.bulkGet(windowIds.map((m) => 'gmail:' + m.id));
  const missing = windowIds.filter((_, i) => !known[i]);
  const jobStartedAt = Date.now();
  await runPool(missing, GMAIL_MAX_CONCURRENCY, async (m) => {
    boundary(ctl);
    try {
      const msg = await getMessage(m.id, 'full', 'background', ctl.signal);
      await ingestMessage(db, msg, 'full', row?.account, jobStartedAt);
    } catch (e) {
      if (!(e instanceof GmailNotFoundError)) throw e;
    }
  });
  await getRuntime(db).keyword.flush();
  await writer.set({ cursor: profile.historyId, phase: 'idle', lastSyncAt: Date.now(), reconciledAt: Date.now(), needsAuth: false, error: undefined, errorCode: undefined }, true);
}

// ---------- the sync controller (one per database) ----------

const pausedDbs = new Set<SieveDb>();

/** Pause stops jobs at the next request boundary (20 section 14.2). */
export function setGmailPaused(db: SieveDb, paused: boolean): void {
  if (paused) pausedDbs.add(db);
  else pausedDbs.delete(db);
}

interface Controller {
  abort: AbortController; running: Promise<void> | null; timer: ReturnType<typeof setInterval> | null; onVisible: (() => void) | null;
  /** Run once more when the current job ends (a new token arrived while it ran). */
  rerun: boolean;
}
const controllers = new Map<SieveDb, Controller>();

async function rowError(db: SieveDb, e: unknown): Promise<void> {
  // A listing that stopped half way found nothing final: the card must not keep saying "so far".
  const rt = getRuntime(db);
  if (rt.syncProgress.get('gmail')?.listing) {
    rt.syncProgress.delete('gmail');
    void rt.queue?.writeRowsNow?.();
  }
  if ((e instanceof SyncStopped && e.why === 'no-token') || e instanceof GmailAuthError) {
    // The token ran out or Gmail refused it. Another tab may have renewed it: ask for Continue only when the row has
    // no usable token either (20 section 15.1).
    if (await loadStoredGmailToken(db).catch(() => null)) {
      await db.sources.update('gmail', { phase: 'idle' });
      const c = controllers.get(db);
      if (c) c.rerun = true;
    } else {
      await db.sources.update('gmail', { needsAuth: true, phase: 'idle' });
    }
    return;
  }
  if (e instanceof SyncStopped) {
    if (e.why === 'paused') await db.sources.update('gmail', { phase: 'idle' });
    return;
  }
  if (e instanceof GmailForbiddenError) return void (await db.sources.update('gmail', { errorCode: 'gmail-forbidden', error: SOURCE_COPY.gmailForbidden(e.reason), phase: 'idle' }));
  if (e instanceof GmailRateError) return void (await db.sources.update('gmail', { errorCode: 'quota', error: SOURCE_COPY.gmailQuota, phase: 'idle' }));
  if (e instanceof GmailNetworkError) return void (await db.sources.update('gmail', { errorCode: 'network', error: SOURCE_COPY.network, phase: 'idle' }));
  if (e instanceof IngestError && e.code === 'storage-full') return;
  if ((e as { name?: string })?.name === 'AbortError') return;
  console.warn('gmail sync failed', String((e as Error)?.message ?? e).slice(0, 80));
  await db.sources.update('gmail', { errorCode: 'unknown', error: "Gmail sync stopped. Sieve will try again soon.", phase: 'idle' });
}

function controllerFor(db: SieveDb): Controller {
  let c = controllers.get(db);
  if (!c) {
    c = { abort: new AbortController(), running: null, timer: null, onVisible: null, rerun: false };
    controllers.set(db, c);
    getRuntime(db).stoppers.add(() => stopGmailSync(db));
  }
  return c;
}

/** One job at a time: resume an unfinished backfill, reconcile weekly, else read history. */
export function runGmailSync(db: SieveDb, mode: 'auto' | 'backfill' | 'reconcile' = 'auto'): Promise<void> {
  const c = controllerFor(db);
  if (c.running) return c.running;
  c.running = (async () => {
    const row = await db.sources.get('gmail');
    if (!row?.connected || row.paused || !isLeader(db)) return;
    // The token on this computer, which any tab may have renewed; Continue is asked for only when there is none.
    if (!(await loadStoredGmailToken(db).catch(() => getGmailToken()))) {
      await db.sources.update('gmail', { needsAuth: true });
      return;
    }
    const ctl: Ctl = { signal: c.abort.signal, isPaused: () => pausedDbs.has(db) };
    try {
      const unfinished = row.phase && row.phase !== 'idle';
      if (mode === 'backfill' || !row.cursor || (unfinished && row.phase !== 'incremental' && row.phase !== 'reconciling')) await backfill(db, ctl);
      else if (mode === 'reconcile' || !row.reconciledAt || Date.now() - row.reconciledAt > GMAIL_RECONCILE_EVERY_MS) await reconcile(db, ctl);
      else await incremental(db, ctl);
    } catch (e) {
      await rowError(db, e);
    }
  })().finally(() => {
    c.running = null;
    if (c.rerun && controllers.get(db) === c) {
      c.rerun = false;
      void runGmailSync(db);
    }
  });
  return c.running;
}

/** A new token reached this tab (another tab kept it on the row): sync now, or right after the job that is running. */
export function syncAfterNewToken(db: SieveDb): void {
  const c = controllerFor(db);
  if (c.running) c.rerun = true;
  else void runGmailSync(db);
}

/** Timers: every GMAIL_SYNC_INTERVAL_MS and when the tab becomes visible (leader only). */
export function startGmailTimers(db: SieveDb): void {
  const c = controllerFor(db);
  if (c.timer) return;
  c.timer = setInterval(() => void runGmailSync(db), GMAIL_SYNC_INTERVAL_MS);
  if (typeof document !== 'undefined') {
    c.onVisible = () => {
      if (document.visibilityState === 'visible') void runGmailSync(db);
    };
    document.addEventListener('visibilitychange', c.onVisible);
  }
}

export async function stopGmailSync(db: SieveDb): Promise<void> {
  const c = controllers.get(db);
  if (!c) return;
  c.abort.abort();
  if (c.timer) clearInterval(c.timer);
  if (c.onVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', c.onVisible);
  const running = c.running;
  controllers.delete(db);
  await running?.catch(() => undefined);
}
