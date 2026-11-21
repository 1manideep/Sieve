// Per-database in-memory state: keyword index, vector matrix, vocabulary, record metadata, the queue handle.
import type { Category, IndexRecord, ItemKind, SourceKind } from '@sieve/shared';
import type { SieveDb } from './db';
import { KeywordIndex } from './keywordIndex';
import { fromAddress } from './text';
import { getVectorIndex, type VectorIndex } from './vectorIndex';
import { Vocab } from './vocab';

/** What search needs about a record without reading it from IndexedDB (filters, boosts, de-duplication). */
export interface RecordMeta {
  id: string; source: SourceKind; kind: ItemKind; category: Category; date: number; version: number;
  threadId?: string; contentHash: string; from?: string; fromAddr: string; title: string;
  mentionedDays?: string[]; hasText: boolean; hasCaption: boolean; sourceModifiedAt?: number;
}

export function metaOf(rec: IndexRecord): RecordMeta {
  return {
    id: rec.id, source: rec.source, kind: rec.kind, category: rec.category, date: rec.date, version: rec.version,
    threadId: rec.threadId, contentHash: rec.contentHash, from: rec.from, fromAddr: fromAddress(rec.from), title: rec.title,
    mentionedDays: rec.mentionedDays, hasText: !!rec.text && rec.text.trim().length > 0, hasCaption: !!rec.caption,
    sourceModifiedAt: rec.sourceModifiedAt,
  };
}

/** The background queue as the index sees it (queue/ingestQueue.ts implements it). */
export interface QueueHooks {
  enqueue(ids: string[], opts?: { priority?: 'normal' | 'high' }): void;
  cancel(ids: string[]): void;
  pause(): void;
  resume?(): void;
  stop(): Promise<void>;
  /** Writes the source rows' progress now instead of after SOURCE_ROW_WRITE_MS (a folder walk has just listed its files). */
  writeRowsNow?(): Promise<void>;
}

export interface Runtime {
  db: SieveDb;
  keyword: KeywordIndex;
  vectors: VectorIndex;
  vocab: Vocab;
  meta: Map<string, RecordMeta>;
  ready: Promise<void> | null;
  vocabReady: Promise<void> | null;
  queue: QueueHooks | null;
  thumbUrls: Map<string, string>;
  /** Stop functions of source jobs and timers for this database (wipeDb, disconnect). */
  stoppers: Set<() => void | Promise<void>>;
  pendingBroadcast: { changed: Set<string>; removed: Set<string>; timer: ReturnType<typeof setTimeout> | null };
  /** What a source's sync job has discovered and not fetched yet (Sources progress, 20 section 13.4). `listing`: it is
   * still finding items, so the total may only grow and the card says "so far" (20 section 13.5). */
  syncProgress: Map<SourceKind, { discovered: number; remaining: number; etaMs?: number; listing?: boolean }>;
}

const runtimes = new Map<SieveDb, Runtime>();
let lastReady: SieveDb | null = null;

export function getRuntime(db: SieveDb): Runtime {
  let rt = runtimes.get(db);
  if (!rt) {
    rt = {
      db,
      keyword: new KeywordIndex(db),
      vectors: getVectorIndex(db),
      vocab: new Vocab(),
      meta: new Map(),
      ready: null,
      vocabReady: null,
      queue: null,
      thumbUrls: new Map(),
      stoppers: new Set(),
      pendingBroadcast: { changed: new Set(), removed: new Set(), timer: null },
      syncProgress: new Map(),
    };
    runtimes.set(db, rt);
  }
  return rt;
}

export function peekRuntime(db: SieveDb): Runtime | undefined {
  return runtimes.get(db);
}

export function dropRuntime(db: SieveDb): void {
  const rt = runtimes.get(db);
  if (!rt) return;
  rt.keyword.dispose();
  rt.vectors.clear();
  rt.vocab.clear();
  rt.meta.clear();
  if (rt.pendingBroadcast.timer) clearTimeout(rt.pendingBroadcast.timer);
  for (const url of rt.thumbUrls.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // jsdom and old browsers
    }
  }
  rt.thumbUrls.clear();
  runtimes.delete(db);
  if (lastReady === db) lastReady = null;
}

export function setLastReady(db: SieveDb): void {
  lastReady = db;
}

/** The database most recently passed to ready(): parseQuestion's default vocabulary (20 section 9). */
export function lastReadyDb(): SieveDb | null {
  return lastReady;
}
