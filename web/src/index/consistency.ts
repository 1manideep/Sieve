// Index consistency (01 section 10, 20 section 5): content hashes, versions, versioned writes, atomic deletes,
// verifyFresh, the startup integrity check and tombstone pruning.
import type { IndexRecord } from '@sieve/shared';
import type { Transaction } from 'dexie';
import { INTEGRITY_REBUILD_RATIO, TOMBSTONE_TTL_DAYS, VERIFY_HASH_SKIP_BYTES } from './config';
import type { RemoveReason, SieveDb, VectorRow } from './db';
import { emitIndexEvent } from './events';
import { blobBytes, sha256Hex } from './hash';
import { broadcast } from './locks';
import { getRuntime, metaOf } from './runtime';

export { sha256Hex } from './hash';

/** Email hash over the message as fetched (20 section 5.2); meta and full phases differ on purpose. */
export function emailContentHash(m: { id: string; subject: string; from?: string; internalDate: number; html?: string; text?: string; phase: 'meta' | 'full' }): Promise<string> {
  return sha256Hex(JSON.stringify([m.id, m.subject, m.from ?? '', m.internalDate, m.html ?? null, m.text ?? null, m.phase]));
}

/** A new id starts at Date.now() so a re-created id never reuses a version a stale job could still hold. */
export function nextVersion(existing?: Pick<IndexRecord, 'version'>): number {
  return existing ? existing.version + 1 : Date.now();
}

// ---------- in-memory upkeep after a commit ----------

function scheduleBroadcast(db: SieveDb): void {
  const pb = getRuntime(db).pendingBroadcast;
  if (pb.timer) return;
  pb.timer = setTimeout(() => {
    pb.timer = null;
    const changed = [...pb.changed];
    const removed = [...pb.removed];
    pb.changed.clear();
    pb.removed.clear();
    if (changed.length > 0) {
      broadcast(db, { type: 'records-changed', ids: changed });
      emitIndexEvent({ type: 'records-changed', db: db.name, ids: changed });
    }
    if (removed.length > 0) {
      broadcast(db, { type: 'records-removed', ids: removed });
      emitIndexEvent({ type: 'records-removed', db: db.name, ids: removed });
    }
  }, 200);
}

/** Keyword document, vocabulary and metadata follow the stored record (vectors are handled by their writers). */
export function applyRecordInMemory(db: SieveDb, rec: IndexRecord): void {
  const rt = getRuntime(db);
  rt.keyword.upsert(rec);
  rt.vocab.update(rec);
  rt.meta.set(rec.id, metaOf(rec));
  const pb = rt.pendingBroadcast;
  pb.removed.delete(rec.id);
  pb.changed.add(rec.id);
  scheduleBroadcast(db);
}

function forgetInMemory(db: SieveDb, ids: string[]): void {
  const rt = getRuntime(db);
  for (const id of ids) {
    rt.vectors.removeRecord(id);
    rt.keyword.discard(id);
    rt.vocab.remove(id);
    rt.meta.delete(id);
    const url = rt.thumbUrls.get(id);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      rt.thumbUrls.delete(id);
    }
    rt.pendingBroadcast.changed.delete(id);
    rt.pendingBroadcast.removed.add(id);
  }
  rt.queue?.cancel(ids);
  scheduleBroadcast(db);
}

// ---------- versioned writes (invariant 6) ----------

export type WriteOutcome = 'ok' | 'gone' | 'stale' | 'noop';

/**
 * One rw transaction over records, tombstones and vectors: write only when the record exists, has the job's
 * version and is not tombstoned. `mutate` returns null when the job's input is stale; an empty patch writes no
 * record change (alsoInTx still runs, e.g. the embed job's vector rows).
 */
export async function writeIfCurrentDetailed(
  db: SieveDb, id: string, version: number,
  mutate: (rec: IndexRecord) => Partial<IndexRecord> | null,
  alsoInTx?: (tx: Transaction, rec: IndexRecord) => Promise<void>,
): Promise<{ outcome: WriteOutcome; record?: IndexRecord }> {
  let outcome: WriteOutcome = 'noop';
  let written: IndexRecord | undefined;
  await db.transaction('rw', db.records, db.tombstones, db.vectors, async (tx) => {
    const rec = await db.records.get(id);
    if (!rec || (await db.tombstones.get(id))) {
      outcome = 'gone';
      return;
    }
    if (rec.version !== version) {
      outcome = 'stale';
      return;
    }
    const patch = mutate(rec);
    if (patch === null) {
      outcome = 'stale';
      return;
    }
    const next = Object.keys(patch).length > 0 ? { ...rec, ...patch } : rec;
    if (next !== rec) await db.records.put(next);
    if (alsoInTx) await alsoInTx(tx, next);
    written = next;
    outcome = 'ok';
  });
  return { outcome, record: written };
}

export async function writeIfCurrent(
  db: SieveDb, id: string, version: number,
  mutate: (rec: IndexRecord) => Partial<IndexRecord> | null,
  alsoInTx?: (tx: Transaction, rec: IndexRecord) => Promise<void>,
): Promise<boolean> {
  return (await writeIfCurrentDetailed(db, id, version, mutate, alsoInTx)).outcome === 'ok';
}

/**
 * The version-checked write every background result and share-time scan goes through (01 section 11.1).
 * `enrich` is merged per task. Never changes `version`. Updates the keyword document after commit.
 */
export async function patchRecord(db: SieveDb, id: string, version: number, patch: Partial<IndexRecord>): Promise<'ok' | 'gone' | 'stale'> {
  const { outcome, record } = await writeIfCurrentDetailed(db, id, version, (rec) => {
    const { version: _v, id: _id, ...rest } = patch;
    const merged: Partial<IndexRecord> = { ...rest };
    if (patch.enrich) merged.enrich = { ...rec.enrich, ...patch.enrich };
    return merged;
  });
  if (outcome === 'ok' && record) applyRecordInMemory(db, record);
  return outcome === 'ok' ? 'ok' : outcome === 'stale' ? 'stale' : 'gone';
}

// ---------- deletion (invariants 4 and 5) ----------

/**
 * One rw transaction over records, vectors, blobs, consents and tombstones, then the in-memory indexes.
 * Idempotent: an id without a record still loses its vectors and gets a tombstone, which stops late jobs.
 */
export async function removeRecord(db: SieveDb, id: string, reason: RemoveReason, opts?: { movedTo?: string }): Promise<void> {
  await removeRecords(db, [id], reason, opts?.movedTo ? { [id]: opts.movedTo } : undefined);
}

export async function removeRecords(db: SieveDb, ids: string[], reason: RemoveReason, movedTo?: Record<string, string>): Promise<number> {
  let removed = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    await db.transaction('rw', [db.records, db.vectors, db.blobs, db.consents, db.tombstones], async () => {
      const now = Date.now();
      for (const id of batch) {
        await db.vectors.where('recordId').equals(id).delete();
        if (await db.records.get(id)) removed++;
        await db.records.delete(id);
        await db.blobs.delete(id);
        await db.consents.delete(id);
        const to = movedTo?.[id];
        await db.tombstones.put(to ? { id, deletedAt: now, reason, movedTo: to } : { id, deletedAt: now, reason });
      }
    });
    forgetInMemory(db, batch);
  }
  return removed;
}

export async function pruneTombstones(db: SieveDb): Promise<number> {
  const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 86_400_000;
  return db.tombstones.where('deletedAt').below(cutoff).delete();
}

// ---------- verifyFresh (invariant 8) ----------

export type FreshResult = 'ok' | 'gone' | 'changed' | 'unknown';
export type UnverifiedReason = 'no-token' | 'no-permission' | 'offline';

/**
 * Checks the chosen item against its source before a proposal is shown. 'gone' and 'changed' also update the
 * index; 'unknown' means the source could not be asked (01 section 11.8): answer from the local copy with a warning.
 */
export async function verifyFresh(db: SieveDb, id: string, opts?: { signal?: AbortSignal; onUnverified?: (reason: UnverifiedReason) => void }): Promise<FreshResult> {
  const rec = await db.records.get(id);
  if (!rec) return 'gone';
  const unknown = (reason: UnverifiedReason): FreshResult => {
    opts?.onUnverified?.(reason);
    return 'unknown';
  };
  if (rec.source === 'gmail') {
    const { getMessage, GmailAuthError, GmailNotFoundError } = await import('../sources/gmail/api');
    const { isTrashed } = await import('../sources/gmail/mime');
    const { getGmailToken } = await import('../sources/gmail/auth');
    if (!getGmailToken()) return unknown('no-token');
    try {
      const msg = await getMessage(rec.sourceRef, 'minimal', 'interactive', opts?.signal);
      if (isTrashed(msg.labelIds)) {
        await removeRecord(db, id, 'trashed');
        return 'gone';
      }
      return 'ok';
    } catch (e) {
      if (e instanceof GmailNotFoundError) {
        await removeRecord(db, id, 'source-deleted');
        return 'gone';
      }
      if ((e as { name?: string }).name === 'AbortError') throw e;
      if (e instanceof GmailAuthError) return unknown('no-token');
      return unknown('offline');
    }
  }
  if (rec.source === 'folder') {
    const { readFolderFile, PermissionNeededError } = await import('../sources/folder/connect');
    let file: File;
    try {
      file = await readFolderFile(db, id);
    } catch (e) {
      if (e instanceof PermissionNeededError || (e as { name?: string }).name === 'NotAllowedError' || (e as { name?: string }).name === 'SecurityError') return unknown('no-permission');
      if ((e as { name?: string }).name === 'NotFoundError') {
        await removeRecord(db, id, 'source-deleted');
        return 'gone';
      }
      return unknown('no-permission');
    }
    if (file.size > VERIFY_HASH_SKIP_BYTES && file.size === rec.sizeBytes && file.lastModified === rec.sourceModifiedAt) return 'ok';
    const hash = await sha256Hex(await blobBytes(file));
    if (hash === rec.contentHash) return 'ok';
    const { reindexFolderFile } = await import('../sources/folder/scan');
    const outcome = await reindexFolderFile(db, rec, file, hash);
    return outcome === 'gone' ? 'gone' : 'changed';
  }
  return 'ok';
}

// ---------- startup integrity check (invariant 9) ----------

export interface IntegrityReport {
  records: number; keywordDocs: number; vectoredRecords: number;
  repaired: { keywordAdded: number; keywordRemoved: number; orphanVectors: number; staleVectors: number; resurrected: number };
  rebuilt: boolean;
  queuedForEmbedding: number;
}

/** Records that need vectors: the embed lane decides the exact inputs; here only "has something to embed". */
export function hasEmbeddableSource(rec: Pick<IndexRecord, 'kind' | 'text' | 'caption' | 'title' | 'preview'>): boolean {
  if (rec.kind === 'photo') return !!rec.caption;
  return true;   // text chunks, or title, sender and preview (Gmail metadata phase), or title only (never)
}

export async function checkIntegrity(db: SieveDb): Promise<IntegrityReport> {
  const rt = getRuntime(db);
  const versions = new Map<string, number>();
  const indexedAt = new Map<string, number>();
  const embeddable = new Set<string>();
  await db.records.each((r) => {
    versions.set(r.id, r.version);
    indexedAt.set(r.id, r.indexedAt);
    if (hasEmbeddableSource(r)) embeddable.add(r.id);
    if (!rt.meta.has(r.id) || rt.meta.get(r.id)?.version !== r.version) rt.meta.set(r.id, metaOf(r));
  });
  for (const id of [...rt.meta.keys()]) if (!versions.has(id)) rt.meta.delete(id);

  const report: IntegrityReport = {
    records: versions.size, keywordDocs: 0, vectoredRecords: 0,
    repaired: { keywordAdded: 0, keywordRemoved: 0, orphanVectors: 0, staleVectors: 0, resurrected: 0 },
    rebuilt: false, queuedForEmbedding: 0,
  };

  // Records written before their own tombstone (a resurrected id): remove again (70 R-IDX-11 step 5).
  const tombs = await db.tombstones.toArray();
  const resurrected = tombs.filter((t) => versions.has(t.id) && (indexedAt.get(t.id) ?? 0) < t.deletedAt).map((t) => t.id);
  if (resurrected.length > 0) {
    await removeRecords(db, resurrected, 'source-deleted');
    for (const id of resurrected) {
      versions.delete(id);
      embeddable.delete(id);
    }
    report.repaired.resurrected = resurrected.length;
  }
  const tombIds = new Set(tombs.map((t) => t.id));

  // Keyword index: add missing, discard extra; rebuild when the repairs are large.
  const kwIds = new Set(rt.keyword.ids());
  const missing = [...versions.keys()].filter((id) => !kwIds.has(id));
  const extra = [...kwIds].filter((id) => !versions.has(id));
  if (missing.length + extra.length > Math.max(1, versions.size * INTEGRITY_REBUILD_RATIO) && versions.size > 0) {
    await rt.keyword.rebuild();
    report.rebuilt = true;
  } else {
    for (const id of extra) rt.keyword.discard(id);
    if (missing.length > 0) {
      const recs = await db.records.bulkGet(missing);
      for (const r of recs) if (r) rt.keyword.upsert(r);
    }
  }
  report.repaired.keywordAdded = report.rebuilt ? 0 : missing.length;
  report.repaired.keywordRemoved = report.rebuilt ? 0 : extra.length;
  report.keywordDocs = rt.keyword.count;

  // Vectors: orphans and stale rows are deleted; the loaded matrix holds only current rows.
  const loaded = await rt.vectors.load(db, versions);
  const orphanIds = loaded.orphans;
  const staleIds = loaded.stale;
  const tombVectorIds: string[] = [];
  for (const recId of rt.vectors.recordIds()) {
    if (tombIds.has(recId)) {
      tombVectorIds.push(recId);
      rt.vectors.removeRecord(recId);
    }
  }
  if (orphanIds.length + staleIds.length + tombVectorIds.length > 0) {
    await db.transaction('rw', db.vectors, async () => {
      await db.vectors.bulkDelete([...orphanIds, ...staleIds]);
      for (const recId of tombVectorIds) await db.vectors.where('recordId').equals(recId).delete();
    });
  }
  report.repaired.orphanVectors = orphanIds.length;
  report.repaired.staleVectors = staleIds.length;
  report.vectoredRecords = rt.vectors.records;

  const needEmbed = [...embeddable].filter((id) => !rt.vectors.has(id));
  report.queuedForEmbedding = needEmbed.length;
  if (needEmbed.length > 0) rt.queue?.enqueue(needEmbed);

  const repairs = report.repaired;
  console.info('integrity', {
    records: report.records, keywordDocs: report.keywordDocs, vectoredRecords: report.vectoredRecords,
    keywordAdded: repairs.keywordAdded, keywordRemoved: repairs.keywordRemoved, orphanVectors: repairs.orphanVectors,
    staleVectors: repairs.staleVectors, resurrected: repairs.resurrected, rebuilt: report.rebuilt, queued: report.queuedForEmbedding,
  });
  emitIndexEvent({ type: 'integrity', db: db.name, report });
  return report;
}

/** Retrieval check (invariant 7): a hit without a record loses its rows; logged as an integrity repair. */
export async function repairOrphanHit(db: SieveDb, id: string): Promise<void> {
  console.info('integrity repair', { kind: 'orphan-hit' });
  await db.vectors.where('recordId').equals(id).delete();
  forgetInMemory(db, [id]);
}

/** Vector rows of one record, as stored (tests and the seed bundle builder). */
export function vectorRowsOf(db: SieveDb, recordId: string): Promise<VectorRow[]> {
  return db.vectors.where('recordId').equals(recordId).toArray();
}

