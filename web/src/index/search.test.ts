// 20 section 20, search: A-SR-2 to A-SR-8 and A-SR-10 on the seeded Playground with the hash embedder.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient, type HashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { nodeFile } from '../../../tests/harness/indexEnv';
import { setMlClient } from '../ml/client';
import { seedPlayground } from '../playground/seed';
import { addUploads } from '../sources/uploads';
import { openDb, type SieveDb } from './db';
import { ingest } from './ingest';
import { wipeDb } from './lifecycle';
import { peekQueue } from './queue/ingestQueue';
import { relativeWhen } from './reasons';
import { relatedFor } from './related';
import { duplicatesOf, search, type SearchReport } from './search';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/playground/assets', async () => (await import('../../../tests/harness/dataset')).assetsModule);

process.env.TZ = 'America/Chicago';
let db: SieveDb;
let ml: HashEmbedClient;

beforeAll(async () => {
  ml = createHashEmbedClient();
  setMlClient(ml);
  db = openDb('playground');
  await seedPlayground(db);
  await peekQueue(db)?.whenIdle();
});

afterAll(async () => {
  await wipeDb('playground');
  setMlClient(null);
});

describe('search', () => {
  it('A-SR-2: vector hits first, then at most 2 keyword extras; no duplicate record or contentHash', async () => {
    const res = await search(db, 'Where is order #88231?');
    const kinds = res.map((c) => c.matchedBy);
    const firstKeyword = kinds.indexOf('keyword');
    if (firstKeyword >= 0) expect(kinds.slice(firstKeyword).every((k) => k === 'keyword')).toBe(true);
    expect(kinds.filter((k) => k === 'keyword').length).toBeLessThanOrEqual(2);
    expect(res.length).toBeLessThanOrEqual(7);
    expect(new Set(res.map((c) => c.recordId)).size).toBe(res.length);
    const hashes = await Promise.all(res.map(async (c) => (await db.records.get(c.recordId))?.contentHash));
    expect(new Set(hashes).size).toBe(res.length);
    expect(res.map((c) => c.recordId)).toContain('playground:pg-mail-21');
  });

  it('A-SR-3: hard filters', async () => {
    await ingest(db, { source: 'upload', sourceRef: 'upload-filter', kind: 'note', title: 'deposit notes.txt', date: Date.now(), text: 'Notes about the deposit and the landlord.' }, 'own');
    const up = await search(db, 'deposit landlord', { sources: ['upload'] });
    expect(up.length).toBeGreaterThan(0);
    expect(up.every((c) => c.recordId.startsWith('upload:'))).toBe(true);
    const work = await search(db, 'planning agenda review', { categories: ['Work'] });
    expect(work.length).toBeGreaterThan(0);
    for (const c of work) expect((await db.records.get(c.recordId))?.category).toBe('Work');
  });

  it('A-SR-4: a date hint that excludes the right item still returns it', async () => {
    const res = await search(db, 'Where is order 88231?', { hints: { after: '2026-01-01', before: '2026-01-31' } });
    expect(res.slice(0, 5).map((c) => c.recordId)).toContain('playground:pg-mail-21');
  });

  it('A-SR-5: embedder not ready gives keyword results and says so', async () => {
    ml.setStatus('embed', { state: 'loading' });
    let report: SearchReport | undefined;
    const res = await search(db, 'Where is order #88231?', { onReport: (r) => (report = r) });
    ml.setStatus('embed', { state: 'ready', device: 'wasm' });
    expect(report?.vector).toMatchObject({ ran: false, reason: 'model-loading' });
    expect(res[0]?.recordId).toBe('playground:pg-mail-21');
    expect(res.every((c) => c.matchedBy === 'keyword')).toBe(true);
  });

  it('A-SR-6: an orphan hit is dropped and its rows deleted', async () => {
    const id = 'playground:pg-mail-27';
    await db.records.delete(id);   // behind the in-memory indexes
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let report: SearchReport | undefined;
    const res = await search(db, 'This week in AI: 5 papers worth reading on-device models retrieval benchmark', { onReport: (r) => (report = r) });
    info.mockRestore();
    expect(res.map((c) => c.recordId)).not.toContain(id);
    expect(report?.repaired).toBeGreaterThanOrEqual(1);
    expect(await db.vectors.where('recordId').equals(id).count()).toBe(0);
  });

  it('A-SR-7: never items are returned, with no chunk', async () => {
    const res = await search(db, 'What do my test results say?');
    const health = res.find((c) => c.recordId === 'playground:pg-mail-15');
    expect(health).toBeDefined();
    expect(health?.chunk).toBeUndefined();
  });

  it('A-SR-8: reasons and relativeWhen', async () => {
    for (const q of ['What did my landlord say about the deposit?', "What's my latest bank balance?", 'Find the photo where I had five hot dogs in my mouth']) {
      for (const c of await search(db, q)) {
        expect(c.reason).toMatch(/^[^:]+: .+$/);
        expect(c.reason.length).toBeLessThanOrEqual(90);
        expect(c.reason).not.toMatch(/[—–]/);
      }
    }
    const now = Date.parse('2026-11-17T09:00:00-06:00');
    const d = (n: number) => relativeWhen(now - n * 86_400_000, now);
    expect([0, 1, 6, 7, 13, 14, 30, 59, 60, 400].map(d)).toEqual(['today', 'yesterday', '6 days ago', 'last week', 'last week', '2 weeks ago', 'last month', 'last month', '2 months ago', 'Oct 2025']);
    expect(relativeWhen(now + 86_400_000, now)).toBe('today');
  });

  it('A-SR-10: relatedFor(pg-mail-02) starts with the same thread and never includes itself', async () => {
    const rel = await relatedFor(db, 'playground:pg-mail-02', 'What did my landlord say about the deposit?');
    expect(rel.length).toBeLessThanOrEqual(3);
    expect(rel.slice(0, 2).map((c) => c.recordId).sort()).toEqual(['playground:pg-mail-01', 'playground:pg-mail-03']);
    expect(rel.map((c) => c.recordId)).not.toContain('playground:pg-mail-02');
    expect(rel[0]?.reason).toMatch(/same thread/);
  });

  it('one candidate per contentHash; duplicatesOf lists the other copies', async () => {
    const [a] = await addUploads(db, [nodeFile('Unique walrus contract text for copies.', 'contract.txt')]);
    const b = await ingest(db, { source: 'upload', sourceRef: 'copy-2', kind: 'note', title: 'contract copy.txt', date: Date.now(), text: 'Unique walrus contract text for copies.' }, 'own');
    await peekQueue(db)?.whenIdle();
    const res = await search(db, 'walrus contract');
    const ids = res.map((c) => c.recordId).filter((id) => id === a?.recordId || id === b.id);
    expect(ids).toHaveLength(1);
    const dups = await duplicatesOf(db, ids[0] as string);
    expect(dups.map((r) => r.id)).toEqual([ids[0] === b.id ? a?.recordId : b.id]);
  });
});
