// 01 section 10 and 20 section 20: A-CON-3, A-CON-5, A-CON-6, A-CON-10 (local sources), A-CON-11, A-CON-12.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '@sieve/shared';
import { aiControl } from '../../../tests/harness/aiMock';
import { createHashEmbedClient, type HashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { dropDb, freshDb, until } from '../../../tests/harness/indexEnv';
import { privacyControl } from '../../../tests/harness/privacyMock';
import { setMlClient } from '../ml/client';
import { checkIntegrity, patchRecord, pruneTombstones, removeRecord, verifyFresh, writeIfCurrent } from './consistency';
import type { SieveDb } from './db';
import { getRecord, ingest } from './ingest';
import { ready } from './lifecycle';
import { peekQueue, startIngestQueue } from './queue/ingestQueue';
import { getRuntime } from './runtime';
import { search } from './search';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));

let db: SieveDb;
let ml: HashEmbedClient;

beforeEach(async () => {
  aiControl.reset();
  privacyControl.reset();
  ml = createHashEmbedClient();
  setMlClient(ml);
  db = freshDb('real');
  await ready(db);
});

afterEach(async () => {
  ml.release();
  await dropDb(db);
  setMlClient(null);
});

const note = (ref: string, text: string, title = `${ref}.txt`) => ({ source: 'upload' as const, sourceRef: ref, kind: 'note' as const, title, date: Date.now(), text });

describe('A-CON-3: same id, new bytes', () => {
  it('re-indexes with version + 1; old vectors and phrases are gone, new ones found', async () => {
    const q = startIngestQueue(db);
    const v1 = await ingest(db, note('w2', 'The deposit of $1,200 was paid by the zebracorn method.'), 'own');
    await q.whenIdle();
    expect((await db.vectors.where('recordId').equals(v1.id).toArray())[0]?.recordVersion).toBe(v1.version);
    const v2 = await ingest(db, note('w2', 'The deposit of $1,400 was paid by the quokkafish method.'), 'own');
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.contentHash).not.toBe(v1.contentHash);
    await q.whenIdle();
    const rows = await db.vectors.where('recordId').equals(v1.id).toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.recordVersion === v2.version)).toBe(true);
    expect((await search(db, 'zebracorn', { live: false })).map((c) => c.recordId)).not.toContain('upload:w2-old');
    const kw = getRuntime(db).keyword.search('zebracorn');
    expect(kw).toHaveLength(0);
    expect(getRuntime(db).keyword.search('quokkafish').map((h) => h.id)).toEqual([v2.id]);
  });
});

describe('A-CON-5: delete during an in-flight job', () => {
  it('embed: the held job completes after removeRecord and writes nothing', async () => {
    ml.hold();
    const q = startIngestQueue(db);
    const rec = await ingest(db, note('d1', 'A long note about the garden fence.'), 'own');
    await until(() => ml.calls.some((c) => c.texts.some((t) => t.includes('garden fence'))));
    await removeRecord(db, rec.id, 'user-removed');
    ml.release();
    await q.whenIdle();
    expect(await getRecord(db, rec.id)).toBeUndefined();
    expect(await db.vectors.where('recordId').equals(rec.id).count()).toBe(0);
    expect(await db.tombstones.get(rec.id)).toMatchObject({ reason: 'user-removed' });
  });

  it('label: a model label for a deleted record is thrown away', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    aiControl.labelImpl = async (items) => {
      await gate;
      return { labels: Object.fromEntries(items.map((i) => [i.id, 'Work' as const])), trace: { kind: 'label', label: 'x', where: 'device', ms: 1, at: 0 } };
    };
    const q = startIngestQueue(db);
    const rec = await ingest(db, note('l1', 'Quarterly planning agenda.'), 'own');
    await until(() => aiControl.labelCalls.length > 0);
    await removeRecord(db, rec.id, 'user-removed');
    open();
    await q.whenIdle();
    expect(await getRecord(db, rec.id)).toBeUndefined();
  });

  it('privacy scan: a save for a deleted record writes nothing', async () => {
    let open!: () => void;
    privacyControl.gate = new Promise<void>((r) => (open = r));
    const q = startIngestQueue(db);
    const rec = await ingest(db, note('p1', 'Write to dana@thistlewick-pm.example soon.'), 'own');
    await until(() => privacyControl.scans.some((s) => s.id === rec.id));
    await removeRecord(db, rec.id, 'user-removed');
    open();
    await q.whenIdle();
    expect(await getRecord(db, rec.id)).toBeUndefined();
    expect(await db.tombstones.get(rec.id)).toBeDefined();
  });
});

describe('A-CON-6: re-index during an in-flight embed', () => {
  it('the old version is not written; the new version is', async () => {
    ml.hold();
    const q = startIngestQueue(db);
    const v1 = await ingest(db, note('r1', 'Original words about tulips.'), 'own');
    await until(() => ml.calls.length > 0);
    const v2 = await ingest(db, note('r1', 'New words about sunflowers.'), 'own');
    ml.release();
    await q.whenIdle();
    const rows = await db.vectors.where('recordId').equals(v1.id).toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.recordVersion === v2.version)).toBe(true);
  });
});

describe('versioned writes', () => {
  it('writeIfCurrent and patchRecord refuse stale versions and deleted ids', async () => {
    const rec = await ingest(db, note('v', 'text'), 'own');
    expect(await writeIfCurrent(db, rec.id, rec.version + 5, () => ({ preview: 'x' }))).toBe(false);
    expect(await patchRecord(db, rec.id, rec.version, { enrich: { label: { v: 1, by: 'device', at: 1 } } })).toBe('ok');
    expect(await patchRecord(db, rec.id, rec.version - 1, { preview: 'x' })).toBe('stale');
    await removeRecord(db, rec.id, 'user-removed');
    expect(await patchRecord(db, rec.id, rec.version, { preview: 'x' })).toBe('gone');
  });
});

describe('A-CON-10: verifyFresh for local sources', () => {
  it('uploads are ok while they exist, gone after removal', async () => {
    const rec = await ingest(db, note('f', 'fresh'), 'own');
    expect(await verifyFresh(db, rec.id)).toBe('ok');
    await removeRecord(db, rec.id, 'user-removed');
    expect(await verifyFresh(db, rec.id)).toBe('gone');
  });
});

describe('A-CON-11: startup integrity', () => {
  it('repairs an orphan vector, a stale-version vector, a keyword doc without a record and a record missing from the keyword index', async () => {
    const q = startIngestQueue(db);
    const a = await ingest(db, note('a', 'apple orchard'), 'own');
    const b = await ingest(db, note('b', 'banana boat'), 'own');
    for (let i = 0; i < 23; i++) await ingest(db, note(`f${i}`, `filler note ${i}`), 'own');
    await q.whenIdle();
    await q.stop();
    const vec = new Float32Array(EMBEDDING_DIMS);
    vec[0] = 1;
    await db.vectors.put({ id: 'upload:ghost#0', recordId: 'upload:ghost', start: 0, end: 0, vector: vec, model: EMBEDDING_MODEL, recordVersion: 1 });
    await db.vectors.put({ id: `${b.id}#9`, recordId: b.id, start: 0, end: 0, vector: vec, model: EMBEDDING_MODEL, recordVersion: b.version - 1 });
    const rt = getRuntime(db);
    rt.keyword.upsert({ ...a, id: 'upload:phantom', title: 'phantom' });
    rt.keyword.discard(a.id);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const report = await checkIntegrity(db);
    info.mockRestore();
    expect(report.repaired).toMatchObject({ keywordAdded: 1, keywordRemoved: 1, orphanVectors: 1, staleVectors: 1 });
    expect(rt.keyword.has(a.id)).toBe(true);
    expect(rt.keyword.has('upload:phantom')).toBe(false);
    expect(await db.vectors.get('upload:ghost#0')).toBeUndefined();
    expect(await db.vectors.get(`${b.id}#9`)).toBeUndefined();
    // many mismatches rebuild the keyword index instead
    for (let i = 0; i < 5; i++) rt.keyword.discard(`upload:f${i}`);
    const quiet = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect((await checkIntegrity(db)).rebuilt).toBe(true);
    quiet.mockRestore();
    expect(rt.keyword.count).toBe(25);
  });
});

describe('A-CON-12: tombstones', () => {
  it('older than 30 days are pruned', async () => {
    await db.tombstones.bulkPut([
      { id: 'upload:old', deletedAt: Date.now() - 31 * 86_400_000, reason: 'user-removed' },
      { id: 'upload:new', deletedAt: Date.now() - 86_400_000, reason: 'user-removed' },
    ]);
    expect(await pruneTombstones(db)).toBe(1);
    expect(await db.tombstones.get('upload:new')).toBeDefined();
  });

  it('a move remembers the new id', async () => {
    await removeRecord(db, 'folder:a/W-2.pdf', 'moved', { movedTo: 'folder:b/W-2.pdf' });
    expect(await db.tombstones.get('folder:a/W-2.pdf')).toMatchObject({ reason: 'moved', movedTo: 'folder:b/W-2.pdf' });
    expect(peekQueue(db)).toBeUndefined();
  });
});
