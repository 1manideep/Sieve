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
import { getRuntime } from './runtime';
import { CAPTION_SESSION_MAX, QUEUE_PACING } from './config';
import { CostTracker, overallEtaMs, restEtaMs } from './queue/eta';
import { flushUrgentEmbeds, setQueueConditions, startIngestQueue } from './queue/ingestQueue';
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
    // the lanes run one after another, so their times add up (20 section 13.4)
    expect(overallEtaMs({ label: 10, caption: 5, embed: 12 })).toBe(27);
    expect(overallEtaMs({ label: 10, caption: 5, embed: 12, privacy: 3 })).toBe(30);
    QUEUE_PACING.nanoRestMs = 1_000;
    QUEUE_PACING.embedRestMs = 250;
    QUEUE_PACING.privacyRestMs = 100;
    try {
      // the rests count too: 25 labels are 3 batches, 40 chunks are 3 embed batches, 7 privacy items, 2 photos
      expect([restEtaMs('label', 25), restEtaMs('embed', 40), restEtaMs('privacy', 7), restEtaMs('caption', 2)]).toEqual([3_000, 750, 700, 2_000]);
    } finally {
      QUEUE_PACING.nanoRestMs = 0;
      QUEUE_PACING.embedRestMs = 0;
      QUEUE_PACING.privacyRestMs = 0;
    }
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 3, 8, 2, 0, 0, 0]);
const captioned = () => {
  aiControl.captionImpl = async () => ({ ok: true, value: { caption: 'A gray cat on a windowsill.' }, trace: { kind: 'caption', label: 'x', where: 'device', ms: 1, at: 0, sdkReported: 'on_device' } });
};
async function addPhotos(n: number): Promise<string[]> {
  const { addUploads } = await import('../sources/uploads');
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const bytes = new Uint8Array([...PNG, i]);                         // distinct bytes: not a duplicate upload
    const [up] = await addUploads(db, [nodeFile(bytes, `cat-${i}.png`, { type: 'image/png' })]);
    if (up?.recordId) out.push(up.recordId);
  }
  return out;
}

describe('20 section 13.5: battery, the captions switch and the session cap', () => {
  afterEach(() => {
    setQueueConditions(db, { onBattery: false, batteryOverride: false, captions: true });
    QUEUE_PACING.captionSessionMax = CAPTION_SESSION_MAX;
  });

  it('on battery every model lane holds until Resume; the text is still searchable', async () => {
    setQueueConditions(db, { onBattery: true });
    const q = startIngestQueue(db);
    await ingest(db, note(1, 'Battery note about lemons.'), 'own');
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(0);
    expect(ml.calls).toHaveLength(0);
    expect(privacyControl.scans).toHaveLength(0);
    expect(q.progress().find((p) => p.stage === 'label')).toMatchObject({ waiting: 'power', total: 1, done: 0 });
    expect(q.pendingBySource().get('upload')).toBe(1);
    expect((await search(db, 'lemons', { live: false })).map((c) => c.recordId)).toContain('upload:n1');
    setQueueConditions(db, { batteryOverride: true });                 // "press Resume to index anyway"
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(1);
    expect(privacyControl.scans).toHaveLength(1);
    expect(q.pendingBySource().get('upload') ?? 0).toBe(0);
  });

  it('plugging in resumes on its own', async () => {
    setQueueConditions(db, { onBattery: true });
    const q = startIngestQueue(db);
    await ingest(db, note(2, 'Plugged in.'), 'own');
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(0);
    setQueueConditions(db, { onBattery: false });
    await q.whenIdle();
    expect(aiControl.labelCalls).toHaveLength(1);
    expect(privacyControl.scans).toHaveLength(1);
  });

  it('captions: off with the switch, on power only (the battery override does not cover them), newest first', async () => {
    captioned();
    setQueueConditions(db, { captions: false });
    const q = startIngestQueue(db);
    const ids = await addPhotos(2);
    await q.whenIdle();
    expect(aiControl.captionCalls).toHaveLength(0);
    expect(q.progress().find((p) => p.stage === 'caption')).toMatchObject({ waiting: 'off', etaMs: 0 });
    expect(q.pendingBySource().get('upload') ?? 0).toBe(0);            // a photo waiting only for a caption is not "left"
    setQueueConditions(db, { captions: true, onBattery: true, batteryOverride: true });
    await q.whenIdle();
    expect(aiControl.captionCalls).toHaveLength(0);
    expect(q.progress().find((p) => p.stage === 'caption')?.waiting).toBe('power');
    setQueueConditions(db, { onBattery: false });
    await q.whenIdle();
    expect(aiControl.captionCalls.map((c) => c.recordId)).toEqual([...ids].reverse());
  });

  it('at most the session cap of captions', async () => {
    captioned();
    expect(CAPTION_SESSION_MAX).toBe(200);
    QUEUE_PACING.captionSessionMax = 2;
    const q = startIngestQueue(db);
    await addPhotos(3);
    await q.whenIdle();
    expect(aiControl.captionCalls).toHaveLength(2);
    expect(q.progress().find((p) => p.stage === 'caption')?.waiting).toBe('limit');
  });

  it('the source row says what the queue works on, and counts the privacy scan as work left', async () => {
    await db.sources.put({ kind: 'upload', connected: true, paused: false, progress: { done: 0, total: 0 } });
    setQueueConditions(db, { onBattery: true });
    const q = startIngestQueue(db);
    for (let i = 0; i < 3; i++) await ingest(db, note(10 + i), 'own');
    await q.whenIdle();
    await getRuntimeQueue().writeRowsNow?.();
    // embeddings go first (20 section 13.1), so the card says "Making the search index" (no count)
    const held = await db.sources.get('upload');
    expect(held).toMatchObject({ progress: { done: 0, total: 3 }, stage: 'embed' });
    expect(held?.stageCount).toBeUndefined();
    let release!: () => void;
    privacyControl.gate = new Promise<void>((r) => (release = r));   // the privacy scan waits here
    setQueueConditions(db, { batteryOverride: true });
    await vi.waitFor(() => expect(privacyControl.scans.length).toBeGreaterThan(0));
    await getRuntimeQueue().writeRowsNow?.();
    expect(await db.sources.get('upload')).toMatchObject({ stage: 'privacy', progress: { total: 3 } });
    expect((await db.sources.get('upload'))!.progress.done).toBeLessThan(3);
    release();
    await q.whenIdle();
    await getRuntimeQueue().writeRowsNow?.();
    const row = await db.sources.get('upload');
    expect(row).toMatchObject({ progress: { done: 3, total: 3 } });
    expect(row?.stage).toBeUndefined();
  });
});

describe('20 section 13.5: a question waits for what was just added, 3 s at most', () => {
  afterEach(() => setQueueConditions(db, { onBattery: false, batteryOverride: false, captions: true }));

  it('resolves once the item added a moment ago has its vectors', async () => {
    const q = startIngestQueue(db);
    await q.whenIdle();
    const rec = await ingest(db, note(70, 'Fresh note about the violin lesson.'), 'own', { priority: 'high' });
    expect(getRuntime(db).vectors.has(rec.id)).toBe(false);
    expect(await flushUrgentEmbeds(db)).toBe('done');
    expect(getRuntime(db).vectors.has(rec.id)).toBe(true);
    expect((await search(db, 'violin lesson', { live: false })).map((c) => c.recordId)).toContain(rec.id);
  });

  it('gives up after the bound, so the question searches anyway', async () => {
    const q = startIngestQueue(db);
    await q.whenIdle();
    ml.hold();
    const rec = await ingest(db, note(71, 'A note the embedder is slow on.'), 'own', { priority: 'high' });
    const t0 = Date.now();
    expect(await flushUrgentEmbeds(db, { timeoutMs: 80 })).toBe('timeout');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    expect(Date.now() - t0).toBeLessThan(2_000);
    ml.release();
    expect(await flushUrgentEmbeds(db)).toBe('done');
    expect(getRuntime(db).vectors.has(rec.id)).toBe(true);
  });

  it('does not wait for bulk work, nor when nothing can run (on battery), nor without a queue', async () => {
    const q = startIngestQueue(db);
    await q.whenIdle();
    ml.hold();
    await ingest(db, note(72, 'A note from a big sync.'), 'own');     // normal priority: bulk
    const t0 = Date.now();
    expect(await flushUrgentEmbeds(db, { timeoutMs: 1_000 })).toBe('done');
    expect(Date.now() - t0).toBeLessThan(500);
    ml.release();
    await q.whenIdle();
    setQueueConditions(db, { onBattery: true });
    await ingest(db, note(73, 'Added on battery.'), 'own', { priority: 'high' });
    await vi.waitFor(() => expect(q.progress().find((p) => p.stage === 'embed')?.waiting).toBe('power'));
    expect(await flushUrgentEmbeds(db, { timeoutMs: 1_000 })).toBe('skipped');
    const other = freshDb('real');                                     // a database whose queue runs in another tab
    expect(await flushUrgentEmbeds(other)).toBe('done');
    await dropDb(other);
  });

  it('an abort ends the wait at once', async () => {
    const q = startIngestQueue(db);
    await q.whenIdle();
    ml.hold();
    await ingest(db, note(74, 'Asked and then stopped.'), 'own', { priority: 'high' });
    const ctl = new AbortController();
    const p = flushUrgentEmbeds(db, { timeoutMs: 3_000, signal: ctl.signal });
    ctl.abort();
    expect(await p).toBe('timeout');
    ml.release();
  });
});

describe('20 section 13.4: one writer of the row progress', () => {
  it('done never goes down in a pass, even when a new label re-opens an item for embedding', async () => {
    await db.sources.put({ kind: 'upload', connected: true, paused: false, progress: { done: 0, total: 0 } });
    // the model sorts every note as Health: its rule is never, so each finished item needs a new embedding
    aiControl.labelImpl = async (items) => ({
      labels: Object.fromEntries(items.map((i) => [i.id, 'Health' as const])),
      by: Object.fromEntries(items.map((i) => [i.id, 'device' as const])),
      trace: { kind: 'label', label: 'x', where: 'device', ms: 1, at: 0 },
    });
    const q = startIngestQueue(db);
    const seen: number[] = [];
    let sampling = true;
    const sample = async () => {
      while (sampling) {
        await getRuntimeQueue().writeRowsNow?.();
        const r = await db.sources.get('upload');
        if (r) seen.push(r.progress.done);
        await new Promise((res) => setTimeout(res, 1));
      }
    };
    const sampler = sample();
    for (let i = 0; i < 12; i++) await ingest(db, note(40 + i, `Note ${i} about the clinic visit.`), 'own');
    await q.whenIdle();
    sampling = false;
    await sampler;
    await getRuntimeQueue().writeRowsNow?.();
    expect(await db.sources.get('upload')).toMatchObject({ progress: { done: 12, total: 12 } });
    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) {
      const total = 12;
      if (seen[i]! < seen[i - 1]! && seen[i - 1]! !== total) throw new Error(`done went down: ${seen.slice(Math.max(0, i - 3), i + 2).join(', ')}`);
    }
  });
});

function getRuntimeQueue() {
  const hooks = getRuntime(db).queue;
  if (!hooks) throw new Error('no queue');
  return hooks;
}
