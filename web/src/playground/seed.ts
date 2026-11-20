// The Playground device (20 section 18): seeding from the committed bundle, the raw-file fallback, Reset, and the
// vector computation that fills in the bundle's embeddings (on the device, through the ingest queue's embed lane).
import { DEFAULT_CATEGORY_RULES, EMBEDDING_MODEL } from '@sieve/shared';
import type { IndexRecord } from '@sieve/shared';
import { embedTexts } from '../index/chunk';
import { PLAYGROUND_NOW } from '../index/config';
import { checkIntegrity } from '../index/consistency';
import { openDb, openDbNamed, type SieveDb, type VectorRow } from '../index/db';
import { ingestInternal } from '../index/ingest';
import { closeDb, ready, wipeDb } from '../index/lifecycle';
import { becomeIndexer } from '../index/locks';
import { startIngestQueue, stopIngestQueue, type IngestQueue } from '../index/queue/ingestQueue';
import { dropRuntime, getRuntime } from '../index/runtime';
import { dropVectorIndex, vectorFromBase64, vectorToBase64 } from '../index/vectorIndex';
import { getMl } from '../ml/client';
import { fetchPlaygroundFile, fetchPlaygroundThumb, loadRawDataset, loadSeedBundle, type SeedBundle } from './assets';

export const SEED_VERSION = 'pg-2026-11-16.2';                           // bump when anything in data/playground changes
export { PLAYGROUND_NOW };                                               // a Tuesday; "last month" is October 2026
export const PLAYGROUND_SEED_COUNT = 46;                                 // 30 emails, 6 documents, 10 photos

const FILE_IDS = [
  'pg-doc-01', 'pg-doc-02', 'pg-doc-03', 'pg-doc-04', 'pg-doc-05', 'pg-doc-06',
  'pg-photo-01', 'pg-photo-02', 'pg-photo-03', 'pg-photo-04', 'pg-photo-05', 'pg-photo-06', 'pg-photo-07', 'pg-photo-08', 'pg-photo-09', 'pg-photo-10',
];

type Progress = (done: number, total: number) => void;

async function seededAlready(db: SieveDb): Promise<boolean> {
  const row = await db.sources.get('playground');
  if (row?.cursor !== SEED_VERSION) return false;
  return (await db.records.where('source').equals('playground').count()) === PLAYGROUND_SEED_COUNT;
}

/** Forget in-memory indexes before the stores are rewritten underneath them. */
async function resetRuntime(db: SieveDb): Promise<void> {
  await stopIngestQueue(db);
  dropRuntime(db);
  dropVectorIndex(db);
}

async function putFiles(db: SieveDb, report: () => void): Promise<void> {
  await Promise.all(FILE_IDS.map(async (seedId) => {
    try {
      const [blob, thumb] = await Promise.all([fetchPlaygroundFile(seedId), seedId.startsWith('pg-photo') ? fetchPlaygroundThumb(seedId) : Promise.resolve(undefined)]);
      await db.blobs.put(thumb ? { id: 'playground:' + seedId, blob, thumb } : { id: 'playground:' + seedId, blob });
    } catch {
      console.warn('Playground sample file not loaded');   // getPhotoBlob falls back to the asset URL
    } finally {
      report();
    }
  }));
}

/** Records and vectors from the bundle, in one transaction (no model calls). */
async function seedFromBundle(db: SieveDb, bundle: SeedBundle): Promise<void> {
  const byId = new Map(bundle.records.map((r) => [r.id, r]));
  const rows: VectorRow[] = bundle.vectors.map((v) => {
    const rec = byId.get(v.recordId);
    const plan = rec ? embedTexts(rec, DEFAULT_CATEGORY_RULES[rec.category]) : undefined;
    return { id: v.id, recordId: v.recordId, start: v.start, end: v.end, vector: vectorFromBase64(v.v), model: bundle.model, recordVersion: v.recordVersion, inputHash: plan?.sourceHash };
  });
  await db.transaction('rw', [db.records, db.vectors, db.blobs, db.search, db.tombstones, db.consents, db.receipts], async () => {
    await Promise.all([db.records.clear(), db.vectors.clear(), db.blobs.clear(), db.search.clear(), db.tombstones.clear(), db.consents.clear(), db.receipts.clear()]);
    await db.records.bulkPut(bundle.records);
    if (rows.length > 0) await db.vectors.bulkPut(rows);
  });
}

/** The fallback: ingest the raw dataset with seed categories and captions (20 section 18.3). */
async function seedFromRaw(db: SieveDb, report: () => void): Promise<void> {
  console.warn('Playground seed bundle missing or stale; seeding from raw files');
  await db.transaction('rw', [db.records, db.vectors, db.blobs, db.search, db.tombstones, db.consents, db.receipts], async () => {
    await Promise.all([db.records.clear(), db.vectors.clear(), db.blobs.clear(), db.search.clear(), db.tombstones.clear(), db.consents.clear(), db.receipts.clear()]);
  });
  const raw = await loadRawDataset();
  for (const e of raw.emails) {
    await ingestInternal(db, {
      source: 'playground', sourceRef: e.id, kind: 'email', title: e.subject, from: e.from, threadId: e.threadId,
      date: Date.parse(e.date), html: e.html, text: e.html ? undefined : e.text,
    }, 'sample', { seed: { category: e.category } });
    report();
  }
  for (const d of raw.documents) {
    const blob = await fetchPlaygroundFile(d.id);
    await ingestInternal(db, { source: 'playground', sourceRef: d.id, kind: d.kind, title: d.file, date: Date.parse(d.date), blob }, 'sample', { seed: { category: d.category } });
    report();
  }
  for (const p of raw.photos) {
    const blob = await fetchPlaygroundFile(p.id);
    const takenAt = Date.parse(p.date);
    await ingestInternal(db, { source: 'playground', sourceRef: p.id, kind: 'photo', title: p.file, date: takenAt, blob }, 'sample', {
      seed: { category: 'Photos', caption: raw.captions[p.id]?.caption },
      photo: { meta: p.place ? { takenAt, place: p.place, hadGps: p.hadGps } : { takenAt, hadGps: p.hadGps }, storeBlob: true },
    });
    report();
  }
}

/** Leader of this database: the queue embeds what has no vectors yet (and runs the privacy lane). */
async function startQueue(db: SieveDb): Promise<IngestQueue | null> {
  let q: IngestQueue | null = null;
  await becomeIndexer(db, () => {
    q = startIngestQueue(db);
  }, () => undefined);
  return q;
}

/**
 * The bundle brings every vector (20 section 18.2), so the queue has nothing to embed and nothing else would load the
 * embedder before the first question; load it now, so that question runs the meaning search and not the keyword-only
 * fallback of the first seconds. A visitor's browser then only embeds their question. Without a Worker (tests) the
 * queue loads it on first need, as before.
 */
function warmEmbedder(): void {
  if (typeof Worker !== 'function') return;
  getMl().warmup('embed').catch(() => undefined);
}

/**
 * 40 CR-4. A second call does nothing; a different SEED_VERSION reseeds. The bundle path makes no model call;
 * records without vectors (a visitor's own files, or a stale bundle) are embedded on this device by the queue.
 */
export async function seedPlayground(db: SieveDb, onProgress?: Progress): Promise<void> {
  await db.open();
  if (await seededAlready(db)) {
    await ready(db);
    await startQueue(db);
    warmEmbedder();
    onProgress?.(PLAYGROUND_SEED_COUNT, PLAYGROUND_SEED_COUNT);
    return;
  }
  await resetRuntime(db);
  const total = PLAYGROUND_SEED_COUNT + FILE_IDS.length;
  let done = 0;
  const report = () => onProgress?.(Math.min(++done, total), total);
  await db.sources.put({ kind: 'playground', connected: true, progress: { done: 0, total: PLAYGROUND_SEED_COUNT }, paused: false, phase: 'seeding' });
  const bundle = await loadSeedBundle();
  if (bundle && bundle.version === SEED_VERSION && bundle.model === EMBEDDING_MODEL) {
    await seedFromBundle(db, bundle);
    done = PLAYGROUND_SEED_COUNT;
    onProgress?.(done, total);
    await putFiles(db, report);
  } else {
    await putFiles(db, () => undefined);
    await seedFromRaw(db, report);
    done += FILE_IDS.length;
  }
  await ready(db);               // keyword index from the records, vectors, integrity check
  await startQueue(db);
  warmEmbedder();
  await getRuntime(db).keyword.flush();
  await db.sources.put({ kind: 'playground', connected: true, cursor: SEED_VERSION, progress: { done: PLAYGROUND_SEED_COUNT, total: PLAYGROUND_SEED_COUNT }, paused: false, lastSyncAt: Date.now(), phase: 'idle' });
  onProgress?.(total, total);
}

/** 40 CR-4: wipe the Playground (added files, test emails, receipts, consents) and return the empty database. */
export async function resetPlayground(): Promise<SieveDb> {
  await wipeDb('playground');
  return openDb('playground');
}

// ---------- the vector computation for the bundle (/dev/seed, 20 section 18.5) ----------

export interface BuildProgress { stage: 'seeding' | 'embedding' | 'scanning' | 'done'; done: number; total: number }

/**
 * Builds seed-bundle.json on this device: the committed records (or the raw dataset when the bundle is missing)
 * in a scratch database, the queue run to completion with this device's models, then records and vectors out.
 */
export async function buildSeedBundle(opts?: { onProgress?: (p: BuildProgress) => void; from?: 'bundle' | 'raw' }): Promise<SeedBundle> {
  const scratch = openDbNamed('sieve-playground-build', 'playground');
  await closeDb(scratch, { flush: false });
  await scratch.delete();
  const db = openDbNamed('sieve-playground-build', 'playground');
  await db.open();
  const bundle = opts?.from === 'raw' ? null : await loadSeedBundle();
  opts?.onProgress?.({ stage: 'seeding', done: 0, total: PLAYGROUND_SEED_COUNT });
  if (bundle && bundle.version === SEED_VERSION) await seedFromBundle(db, { ...bundle, vectors: [] });
  else await seedFromRaw(db, () => undefined);
  await ready(db);
  const queue = await startQueue(db);
  if (!queue) throw new Error('Another tab is building the seed bundle.');
  const unsub = queue.subscribe((p) => {
    const embed = p.find((x) => x.stage === 'embed');
    if (embed) opts?.onProgress?.({ stage: 'embedding', done: embed.done, total: embed.total });
  });
  await queue.whenIdle();
  await checkIntegrity(db);
  await queue.whenIdle();
  unsub();
  const records = (await db.records.toArray()).sort((a, b) => a.id.localeCompare(b.id, 'en')) as IndexRecord[];
  const vectors = (await db.vectors.toArray()).sort((a, b) => a.id.localeCompare(b.id, 'en')).map((v) => ({
    id: v.id, recordId: v.recordId, start: v.start, end: v.end, recordVersion: v.recordVersion, v: vectorToBase64(v.vector),
  }));
  await closeDb(db, { flush: false });
  await db.delete();
  opts?.onProgress?.({ stage: 'done', done: records.length, total: records.length });
  return { version: SEED_VERSION, model: EMBEDDING_MODEL, createdAt: new Date().toISOString(), records, vectors };
}
