// ready() and wipeDb() (20 section 4.1), and how a tab applies another tab's writes (20 section 4.4).
import Dexie from 'dexie';
import { PLAYGROUND_DB_NAME, REAL_DB_NAME } from '@sieve/shared';
import { checkIntegrity, pruneTombstones } from './consistency';
import { forgetDb, openDb, peekDb, type SieveDb } from './db';
import { emitIndexEvent, onIndexEvent } from './events';
import { onBroadcast, releaseIndexer } from './locks';
import { stopIngestQueue } from './queue/ingestQueue';
import { dropRuntime, getRuntime, metaOf, setLastReady } from './runtime';
import { dropVectorIndex } from './vectorIndex';

const unsubs = new Map<SieveDb, () => void>();

async function applyRemoteChanges(db: SieveDb, ids: string[]): Promise<void> {
  const rt = getRuntime(db);
  const recs = await db.records.bulkGet(ids);
  const rows = await db.vectors.where('recordId').anyOf(ids).toArray();
  for (const [i, id] of ids.entries()) {
    const rec = recs[i];
    if (!rec) {
      rt.keyword.discard(id);
      rt.vocab.remove(id);
      rt.meta.delete(id);
      rt.vectors.removeRecord(id);
      continue;
    }
    rt.keyword.upsert(rec);
    rt.vocab.update(rec);
    rt.meta.set(id, metaOf(rec));
    const mine = rows.filter((r) => r.recordId === id && r.recordVersion === rec.version);
    if (mine.length > 0) rt.vectors.upsertRecord(id, mine);
    else rt.vectors.removeRecord(id);
  }
  rt.queue?.enqueue(ids);   // the leader runs background stages for items a follower added
}

function applyRemoteRemovals(db: SieveDb, ids: string[]): void {
  const rt = getRuntime(db);
  for (const id of ids) {
    rt.keyword.discard(id);
    rt.vocab.remove(id);
    rt.meta.delete(id);
    rt.vectors.removeRecord(id);
  }
  rt.queue?.cancel(ids);
}

/**
 * Idempotent and shared: open, load the keyword snapshot (rebuild when missing or unreadable), record metadata,
 * the vector matrix and the integrity check, tombstone pruning; the vocabulary builds in the background.
 */
export function ready(db: SieveDb): Promise<void> {
  // Closed by another tab's delete or upgrade: opening again would recreate the database here (reload the tab).
  if (db.stale) return Promise.reject(new Dexie.DatabaseClosedError('Sieve was updated in another tab.'));
  const rt = getRuntime(db);
  rt.ready ??= (async () => {
    await db.open();
    setLastReady(db);
    const loaded = await rt.keyword.load();
    await db.records.each((r) => {
      rt.meta.set(r.id, metaOf(r));
    });
    if (!loaded && rt.meta.size > 0) await rt.keyword.rebuild();
    await checkIntegrity(db);
    await pruneTombstones(db);
    rt.vocabReady = rt.vocab.build(db).catch(() => undefined);
    if (!unsubs.has(db)) {
      unsubs.set(db, onBroadcast(db, (msg) => {
        if (msg.type === 'records-changed') void applyRemoteChanges(db, msg.ids);
        else if (msg.type === 'records-removed') applyRemoteRemovals(db, msg.ids);
      }));
    }
  })().catch((e: unknown) => {
    rt.ready = null;
    throw e;
  });
  return rt.ready;
}

/** Resolves when the background vocabulary build of ready() has finished (typo correction uses it). */
export async function whenVocabReady(db: SieveDb): Promise<void> {
  await ready(db);
  await getRuntime(db).vocabReady;
}

/** How long a delete may wait for other tabs to close their connections before the person is asked to close them. */
export const DB_DELETE_BLOCKED_MS = 4_000;

/** Another tab still holds the database open (an older copy of Sieve, or a stuck tab): "Close other Sieve tabs". */
export class DbBlockedError extends Error {
  constructor() {
    super('Close other Sieve tabs, then try again.');
    this.name = 'DbBlockedError';
  }
}

/** Dexie.delete, or DbBlockedError after `ms` while another tab keeps it open. The delete itself stays queued. */
export async function deleteDbOrTimeout(name: string, ms = DB_DELETE_BLOCKED_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const blocked = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      emitIndexEvent({ type: 'db-blocked', db: name });
      reject(new DbBlockedError());
    }, ms);
  });
  try {
    await Promise.race([Dexie.delete(name), blocked]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stop everything for that database, delete it, and drop its in-memory indexes (Reset, Delete my account). */
export async function wipeDb(kind: 'real' | 'playground'): Promise<void> {
  const name = kind === 'real' ? REAL_DB_NAME : PLAYGROUND_DB_NAME;
  const db = openDb(kind);
  await closeDb(db, { flush: false });
  await deleteDbOrTimeout(name);
}

// Another tab deleted or upgraded a database this tab had open (db.ts closed the handle): stop its queue, source jobs
// and timers here, but keep the closed handle as the singleton, so nothing in this tab opens the database again.
onIndexEvent((e) => {
  if (e.type !== 'db-closed') return;
  const db = peekDb(e.db);
  if (db) void closeDb(db, { flush: false, keepHandle: true }).catch(() => undefined);
});

/** Stops the queue and source jobs and closes the handle; the next openDb gives a fresh one (unless `keepHandle`). */
export async function closeDb(db: SieveDb, opts?: { flush?: boolean; keepHandle?: boolean }): Promise<void> {
  const rt = getRuntime(db);
  await stopIngestQueue(db);
  for (const stop of [...rt.stoppers]) {
    try {
      await stop();
    } catch {
      // keep stopping the rest
    }
  }
  rt.stoppers.clear();
  if (opts?.flush !== false) await rt.keyword.flush().catch(() => undefined);
  unsubs.get(db)?.();
  unsubs.delete(db);
  releaseIndexer(db);
  dropRuntime(db);
  dropVectorIndex(db);
  db.close();
  if (!opts?.keepHandle) forgetDb(db.name);
}
