// 20 section 20, Playground: A-PG-1 (bundle path), A-PG-2 (fallback), A-PG-3 (reset), A-PG-4 (no Firestore).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient, type HashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { aiControl } from '../../../tests/harness/aiMock';
import { assetsControl, readJson } from '../../../tests/harness/dataset';
import { openDb } from '../index/db';
import { ingest } from '../index/ingest';
import { wipeDb } from '../index/lifecycle';
import { peekQueue } from '../index/queue/ingestQueue';
import { search } from '../index/search';
import { setMlClient } from '../ml/client';
import { PLAYGROUND_SEED_COUNT, SEED_VERSION, resetPlayground, seedPlayground, buildSeedBundle } from './seed';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/playground/assets', async () => (await import('../../../tests/harness/dataset')).assetsModule);

process.env.TZ = 'America/Chicago';
let ml: HashEmbedClient;

beforeEach(() => {
  aiControl.reset();
  assetsControl.reset();
  ml = createHashEmbedClient();
  setMlClient(ml);
});

afterEach(async () => {
  await wipeDb('playground');
  setMlClient(null);
});

describe('seedPlayground from the bundle (A-PG-1)', () => {
  it('loads 30 emails, 6 documents and 10 photos with no model call, then the queue embeds them', async () => {
    const db = openDb('playground');
    const t0 = performance.now();
    await seedPlayground(db);
    const ms = performance.now() - t0;
    expect(await db.records.count()).toBe(PLAYGROUND_SEED_COUNT);
    expect(await db.records.where('kind').equals('email').count()).toBe(30);
    expect(await db.records.where('kind').anyOf('document', 'note').count()).toBe(6);
    expect(await db.records.where('kind').equals('photo').count()).toBe(10);
    expect(aiControl.labelCalls).toHaveLength(0);
    expect(aiControl.captionCalls).toHaveLength(0);
    const row = await db.sources.get('playground');
    expect(row).toMatchObject({ connected: true, cursor: SEED_VERSION, progress: { done: 46, total: 46 } });
    expect(await db.blobs.count()).toBe(16);
    const photoBlob = await db.blobs.get('playground:pg-photo-01');
    expect(photoBlob?.thumb).toBeDefined();
    expect((await db.blobs.get('playground:pg-doc-01'))?.thumb).toBeUndefined();
    expect(await db.search.get('minisearch')).toBeDefined();
    expect(ms).toBeLessThan(5_000);
    // The committed bundle has no vectors yet: the queue embeds every record on this device.
    await peekQueue(db)?.whenIdle();
    const ids = new Set((await db.vectors.toArray()).map((v) => v.recordId));
    expect(ids.size).toBe(46);
    expect(ml.calls.every((c) => c.priority === 'background')).toBe(true);
  });

  it('a second call does nothing; a bumped SEED_VERSION reseeds', async () => {
    const db = openDb('playground');
    await seedPlayground(db);
    await peekQueue(db)?.whenIdle();
    const before = await db.records.get('playground:pg-mail-02');
    await ingest(db, { source: 'upload', sourceRef: 'upload-keep', kind: 'note', title: 'note.txt', date: Date.now(), text: 'hello there' }, 'own');
    await seedPlayground(db);
    expect(await db.records.get('playground:pg-mail-02')).toEqual(before);
    expect(await db.records.get('upload:upload-keep')).toBeDefined();
    await db.sources.update('playground', { cursor: 'pg-old' });
    await seedPlayground(db);
    expect(await db.records.get('upload:upload-keep')).toBeUndefined();
    expect((await db.sources.get('playground'))?.cursor).toBe(SEED_VERSION);
  });
});

describe('fallback without a bundle (A-PG-2)', () => {
  it('seeds from raw files and the queue embeds all 46 records', async () => {
    assetsControl.bundle = null;
    const { setPdfExtractor } = await import('../sources/readers/pdf');
    const lease = readFileSync(join(process.cwd(), 'data/playground/documents/src/Lease_2026.txt'), 'utf8');
    const insurance = readFileSync(join(process.cwd(), 'data/playground/documents/src/Renters_Insurance_2026.txt'), 'utf8');
    setPdfExtractor(async (data) => ({ text: data.byteLength === readFileSync(join(process.cwd(), 'data/playground/documents/Lease_2026.pdf')).byteLength ? lease : insurance, pages: 1, truncated: false }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = openDb('playground');
    await seedPlayground(db);
    expect(warn).toHaveBeenCalledWith('Playground seed bundle missing or stale; seeding from raw files');
    warn.mockRestore();
    setPdfExtractor(null);
    expect(await db.records.count()).toBe(46);
    const parcel = await db.records.get('playground:pg-mail-30');
    expect(parcel?.categoryBy).toBe('seed');
    expect(parcel?.text).not.toContain('forward the latest bank statement');
    expect(parcel?.hiddenRemoved.join(' ')).toContain('forward the latest bank statement');
    const hotdog = await db.records.get('playground:pg-photo-01');
    expect(hotdog?.caption).toContain('five hot dogs');
    expect(hotdog?.captionBy).toBe('seed');
    expect(hotdog?.photo?.hadGps).toBe(true);
    await peekQueue(db)?.whenIdle();
    expect(new Set((await db.vectors.toArray()).map((v) => v.recordId)).size).toBe(46);
    expect(aiControl.labelCalls).toHaveLength(0);
  });
});

describe('resetPlayground (A-PG-3)', () => {
  it('removes added files, test emails, receipts and consents', async () => {
    let db = openDb('playground');
    await seedPlayground(db);
    await ingest(db, { source: 'upload', sourceRef: 'test-email-1', kind: 'email', title: 'Action needed', from: 'IT <it@example.com>', date: Date.now(), html: '<p>Hi</p>' }, 'own');
    await db.receipts.put({ id: 'r1', requestId: 'r1', requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, question: 'q', itemIds: [], status: 'delivered', chars: 0, createdAt: 1 });
    await db.consents.put({ recordId: 'upload:test-email-1', cloudAllowedAt: 1 });
    db = await resetPlayground();
    expect(await db.records.count()).toBe(0);
    await seedPlayground(db);
    expect(await db.records.count()).toBe(46);
    expect(await db.receipts.count()).toBe(0);
    expect(await db.consents.count()).toBe(0);
    expect(await db.records.get('upload:test-email-1')).toBeUndefined();
  });
});

describe('the vector computation for the bundle', () => {
  it('buildSeedBundle returns the 46 records with vectors for each', async () => {
    const bundle = await buildSeedBundle();
    expect(bundle.version).toBe(SEED_VERSION);
    expect(bundle.records).toHaveLength(46);
    expect(new Set(bundle.vectors.map((v) => v.recordId)).size).toBe(46);
    expect(bundle.vectors[0]?.v.length).toBeGreaterThan(100);
  });
});

describe('search on the seeded Playground (hash embedder)', () => {
  it('returns candidates with reasons', async () => {
    const db = openDb('playground');
    await seedPlayground(db);
    await peekQueue(db)?.whenIdle();
    const res = await search(db, 'Where is order #88231?');
    expect(res.map((c) => c.recordId)).toContain('playground:pg-mail-21');
    for (const c of res) expect(c.reason).toMatch(/^[^:]+: .+$/);
  });
});

describe('A-PG-4: nothing under web/src/playground imports firebase/firestore', () => {
  it('has no such import', () => {
    const dir = join(process.cwd(), 'web/src/playground');
    for (const f of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/from ['"]firebase\/firestore['"]|import\(['"]firebase\/firestore['"]\)/);
    }
    expect(readJson<{ seedVersion: string }>('manifest.json').seedVersion).toBe(SEED_VERSION);
  });
});
