// 20 section 20, the background queue: A-QU-1 to A-QU-5 and the privacy lane (01 section 11.1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_MODEL } from '@sieve/shared';
import { aiControl } from '../../../tests/harness/aiMock';
import { createHashEmbedClient, type HashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { dropDb, freshDb, nodeFile } from '../../../tests/harness/indexEnv';
import { privacyControl } from '../../../tests/harness/privacyMock';
import { setMlClient } from '../ml/client';
import { embedTexts } from './chunk';
import { patchRecord } from './consistency';
import type { SieveDb } from './db';
import { getRecord, ingest } from './ingest';
import { ready } from './lifecycle';
import { CostTracker, overallEtaMs } from './queue/eta';
import { startIngestQueue } from './queue/ingestQueue';
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

const note = (i: number, text = `Note ${i} about the kitchen.`) => ({ source: 'upload' as const, sourceRef: `n${i}`, kind: 'note' as const, title: `note-${i}.txt`, date: 1_700_000_000_000 + i * 1000, text });

describe('A-QU-1: labels', () => {
  it('batches of 10, newest first, through versioned writes; the Health safety net re-applies', async () => {
    for (let i = 0; i < 25; i++) await ingest(db, note(i), 'own');
    await ingest(db, { source: 'upload', sourceRef: 'lab', kind: 'email', title: 'Your lab results are ready', from: 'Results <r@results.example>', date: 1_800_000_000_000, text: 'Log in to see.' }, 'own');
    aiControl.labelImpl = async (items) => ({
      labels: Object.fromEntries(items.map((i) => [i.id, 'Personal' as const])),
      by: Object.fromEntries(items.map((i) => [i.id, 'device' as const])),
      trace: { kind: 'label', label: 'x', where: 'device', ms: 8, at: 0 },
    });
    const q = startIngestQueue(db);
    await q.whenIdle();
    expect(aiControl.labelCalls.map((c) => c.ids.length)).toEqual([10, 10, 6]);
    expect(aiControl.labelCalls[0]?.ids[0]).toBe('upload:lab');
    expect(aiControl.labelCalls[0]?.ids[1]).toBe('upload:n24');
    expect(aiControl.labelCalls.every((c) => c.priority === 'background')).toBe(true);
    const lab = await getRecord(db, 'upload:lab');
    expect(lab).toMatchObject({ category: 'Health', categoryBy: 'rule' });
    const n0 = await getRecord(db, 'upload:n0');
    expect(n0).toMatchObject({ category: 'Personal', categoryBy: 'device' });
    expect(n0?.enrich?.label).toMatchObject({ v: 1, by: 'device', attempts: 1 });
  });

  it('own data waits for the on-device model', async () => {
    aiControl.setNano('downloadable');
    await ingest(db, note(1), 'own');
    const q = startIngestQueue(db);
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(0);
    expect(q.progress().find((p) => p.stage === 'label')).toMatchObject({ waiting: 'model', total: 1, done: 0 });
    // The availability event wakes the lane at once (no recheck timer), so idle now means the label ran.
    aiControl.setNano('available');
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(1);
  });
});

describe('A-QU-2: embeddings', () => {
  it('writes rows with the record version and the model; a caption change while embedding discards and re-queues', async () => {
    const q = startIngestQueue(db);
    const rec = await ingest(db, note(1, 'The red bicycle by the lamp post.'), 'own');
    await q.whenIdle();
    const rows = await db.vectors.where('recordId').equals(rec.id).toArray();
    expect(rows[0]).toMatchObject({ recordVersion: rec.version, model: EMBEDDING_MODEL, inputHash: embedTexts(rec, 'approve').sourceHash });
    // a photo whose caption changes between embedding and writing
    aiControl.captionImpl = async () => ({ ok: true, value: { caption: 'A gray cat on a windowsill.' }, trace: { kind: 'caption', label: 'x', where: 'device', ms: 1, at: 0, sdkReported: 'on_device' } });
    const [up] = await (await import('../sources/uploads')).addUploads(db, [nodeFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 3, 8, 2, 0, 0, 0]), 'cat.png', { type: 'image/png' })]);
    await q.whenIdle();
    const photo = await getRecord(db, up?.recordId ?? '');
    expect(photo?.caption).toBe('A gray cat on a windowsill.');
    ml.hold();
    await patchRecord(db, photo?.id ?? '', photo?.version ?? 0, { caption: 'A gray cat asleep in the sun.' });
    q.enqueue([photo?.id ?? '']);
    await ml.whenCalled((texts) => texts.some((t) => t.includes('asleep in the sun')));
    await patchRecord(db, photo?.id ?? '', photo?.version ?? 0, { caption: 'A gray cat, third caption.' });
    ml.release();
    q.enqueue([photo?.id ?? '']);
    await q.whenIdle();
    const finalRows = await db.vectors.where('recordId').equals(photo?.id ?? '').toArray();
    const cur = await getRecord(db, photo?.id ?? '');
    expect(finalRows).toHaveLength(1);
    expect(finalRows[0]?.inputHash).toBe(embedTexts(cur!, 'approve').sourceHash);
  });
});

describe('A-QU-3: never items', () => {
  it('get one vector from title and sender only, and only plain-code privacy stages', async () => {
    const q = startIngestQueue(db);
    const rec = await ingest(db, { source: 'upload', sourceRef: 'rx', kind: 'email', title: 'Your prescription is ready', from: 'Fernquill Pharmacy <rx@fernquill.example>', date: 1, text: 'Prescription number RX-6620194 is ready.' }, 'own');
    expect(rec.category).toBe('Health');
    await q.whenIdle();
    expect(ml.calls.flatMap((c) => c.texts).filter((t) => t.includes('prescription'))).toEqual(['Your prescription is ready\nFernquill Pharmacy']);
    expect(await db.vectors.where('recordId').equals(rec.id).count()).toBe(1);
    expect(privacyControl.scans.find((s) => s.id === rec.id)?.rule).toBe('never');
  });
});

describe('A-QU-4: pause', () => {
  it('stops all lanes and the privacy lane; questions still return results', async () => {
    const q = startIngestQueue(db);
    q.pause();
    await ingest(db, note(1, 'Paused note about tomatoes.'), 'own');
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(0);
    expect(privacyControl.scans).toHaveLength(0);
    expect(q.privacy.status().paused).toBe(true);
    const res = await search(db, 'tomatoes', { live: false });
    expect(res.map((c) => c.recordId)).toContain('upload:n1');
    q.resume();
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(1);
    expect(privacyControl.scans).toHaveLength(1);
    expect((await getRecord(db, 'upload:n1'))?.privacyScan).toBeDefined();
  });
});

describe('the privacy lane', () => {
  it('scans each record once, writes through the version check, and scanNow answers first', async () => {
    const q = startIngestQueue(db);
    const rec = await ingest(db, note(1, 'Email me at alex.rivera@inbox.example please.'), 'own');
    await q.whenIdle();
    const scanned = await getRecord(db, rec.id);
    expect(scanned?.pii[0]).toMatchObject({ type: 'email', by: 'validator' });
    const n = privacyControl.scans.length;
    q.privacy.refreshAll();
    await q.whenIdle();
    expect(privacyControl.scans.length).toBe(n);   // current scans are not repeated
    const r2 = await ingest(db, note(2, 'Another note.'), 'own');
    const now = await q.privacy.scanNow(r2.id);
    expect(now?.privacyScan).toBeDefined();
  });
});

describe('A-QU-5: ETA', () => {
  it('with 8 s per batch of 10, secPerItem moves toward 0.8 and 100 items are about 80 s', () => {
    const t = new CostTracker(0.8);
    for (let i = 0; i < 5; i++) t.observe(10, 8_000);
    expect(t.secPerItem).toBeCloseTo(0.8, 5);
    expect(Math.abs(t.etaMs(100) - 80_000)).toBeLessThan(8_000);
    const slow = new CostTracker(0.8);
    for (let i = 0; i < 5; i++) slow.observe(10, 16_000);
    expect(slow.secPerItem).toBeGreaterThan(1.1);
    expect(slow.secPerItem).toBeLessThan(1.6);
    expect(overallEtaMs({ label: 10, caption: 5, embed: 12 })).toBe(15);
  });
});
