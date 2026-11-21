// 20 section 20, database: A-DB-1 (names, singletons, stores), A-DB-2 (upgrade), A-DB-3 (fingerprint), A-DB-4 (quota).
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_DB_NAME, REAL_DB_NAME } from '@sieve/shared';
import { createHashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { dropDb, freshDb, until } from '../../../tests/harness/indexEnv';
import { setMlClient } from '../ml/client';
import { DB_VERSION, PLAYGROUND_NOW, SEARCH_FINGERPRINT, STORAGE_RECHECK } from './config';
import { checkIntegrity } from './consistency';
import { SCHEMA_V1, SieveDb, clockFor, dataClassOf, openDb, peekDb } from './db';
import { onIndexEvent } from './events';
import { IngestError, ingest } from './ingest';
import { DbBlockedError, deleteDbOrTimeout, ready } from './lifecycle';
import { peekQueue, startIngestQueue } from './queue/ingestQueue';
import { getRuntime } from './runtime';
import { isQuotaError } from './storage';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));

beforeEach(() => setMlClient(createHashEmbedClient()));
afterEach(() => setMlClient(null));

describe('A-DB-1: names, singletons, the eight stores', () => {
  it('opens both databases by name, once per kind, with exactly the SCHEMA_V1 indexes', async () => {
    const real = openDb('real');
    const pg = openDb('playground');
    expect(real.name).toBe(REAL_DB_NAME);
    expect(pg.name).toBe(PLAYGROUND_DB_NAME);
    expect(openDb('real')).toBe(real);
    await real.open();
    const stores = Object.fromEntries(real.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')]));
    expect(stores).toEqual(SCHEMA_V1);
    expect(clockFor(pg)).toBe(PLAYGROUND_NOW);
    expect(dataClassOf(real, { source: 'playground' })).toBe('own');
    expect(dataClassOf(pg, { source: 'playground' })).toBe('sample');
    expect(dataClassOf(pg, { source: 'upload' })).toBe('own');
    real.close();
  });
});

describe('A-DB-3: the search fingerprint is pinned to DB_VERSION', () => {
  it('changing the tokenizer, chunker or model needs a new database version', () => {
    expect({ DB_VERSION, SEARCH_FINGERPRINT }).toEqual({ DB_VERSION: 1, SEARCH_FINGERPRINT: 'kw1|chunk1|Xenova/all-MiniLM-L6-v2' });
  });
});

describe('A-DB-2: a v1 database opens under a v2 that clears search and vectors', () => {
  it('keeps records; the integrity check rebuilds the keyword index and queues every embeddable record', async () => {
    const v1 = freshDb();
    const name = v1.name;
    await ready(v1);
    startIngestQueue(v1);
    for (let i = 0; i < 5; i++) await ingest(v1, { source: 'upload', sourceRef: `n${i}`, kind: 'note', title: `note ${i}.txt`, date: 1_700_000_000_000 + i, text: `Note number ${i} about the garden.` }, 'own');
    await peekQueue(v1)?.whenIdle();
    await getRuntime(v1).keyword.flush();
    expect(await v1.vectors.count()).toBe(5);
    const { closeDb } = await import('./lifecycle');
    await closeDb(v1);

    class V2 extends SieveDb {
      constructor() {
        super(name, 'real');
        this.version(2).stores({}).upgrade(async (tx) => {
          await tx.table('search').clear();
          await tx.table('vectors').clear();
        });
      }
    }
    const v2 = new V2();
    await ready(v2);
    expect(await v2.records.count()).toBe(5);
    expect(await v2.vectors.count()).toBe(0);
    expect(getRuntime(v2).keyword.count).toBe(5);
    const report = await checkIntegrity(v2);
    expect(report.queuedForEmbedding).toBe(5);
    startIngestQueue(v2);
    await until(async () => (await v2.vectors.count()) === 5);
    await dropDb(v2);
  });
});

describe('A-DB-4: storage full during ingest', () => {
  it('gives IngestError storage-full, pauses indexing on the rows (so Resume shows) and resumes once there is room', async () => {
    const db = freshDb();
    await ready(db);
    const q = startIngestQueue(db);
    await db.sources.put({ kind: 'upload', connected: true, progress: { done: 0, total: 0 }, paused: false });
    await db.sources.put({ kind: 'gmail', connected: true, progress: { done: 0, total: 0 }, paused: false, phase: 'metadata' });
    await db.sources.put({ kind: 'folder', connected: true, progress: { done: 0, total: 0 }, paused: true, pausedBy: 'person' });
    const nav = navigator as unknown as { storage?: unknown };
    const prev = nav.storage;
    let usage = 95;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage, quota: 100 }), persisted: async () => false, persist: async () => false } });
    const every = STORAGE_RECHECK.everyMs;
    STORAGE_RECHECK.everyMs = 20;
    try {
      await expect(ingest(db, { source: 'gmail', sourceRef: 'big', kind: 'email', title: 'Big', date: 1, text: 'hello' }, 'own')).rejects.toMatchObject({ code: 'storage-full' });
      expect(q.paused).toBe(true);
      expect(await db.sources.get('gmail')).toMatchObject({
        paused: true, pausedBy: 'storage', phase: 'idle', errorCode: 'storage-full',
        error: 'This browser is almost out of space for Sieve. Free some disk space or disconnect a source.',
      });
      expect(await db.sources.get('upload')).toMatchObject({ paused: true, pausedBy: 'storage' });
      expect(await db.sources.get('folder')).toMatchObject({ paused: true, pausedBy: 'person' });   // the person's own pause stays
      await new Promise((r) => setTimeout(r, 60));
      expect((await db.sources.get('gmail'))?.paused).toBe(true);   // still no room: still paused
      usage = 10;   // the person freed some space
      await until(async () => (await db.sources.get('gmail'))?.paused === false);
      const gmail = await db.sources.get('gmail');
      expect([gmail?.paused, gmail?.pausedBy, gmail?.errorCode, gmail?.error]).toEqual([false, undefined, undefined, undefined]);
      expect(await db.sources.get('upload')).toMatchObject({ paused: false });
      expect(await db.sources.get('folder')).toMatchObject({ paused: true, pausedBy: 'person' });
      expect(q.paused).toBe(false);
    } finally {
      STORAGE_RECHECK.everyMs = every;
      Object.defineProperty(navigator, 'storage', { configurable: true, value: prev });
    }
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(new IngestError('storage-full', 'x').code).toBe('storage-full');
    await dropDb(db);
  });
});

describe('R-PLAT-09: another tab deletes or upgrades the database', () => {
  it('an open connection closes itself, so a delete from a second connection resolves', async () => {
    const a = freshDb();
    await ready(a);
    startIngestQueue(a);
    const events: string[] = [];
    const off = onIndexEvent((e) => {
      if (e.type === 'db-closed') events.push(e.db);
    });
    try {
      // the second connection: another tab's Delete, "Clear it and continue" or Playground Reset. A raw request, as
      // from another page: Dexie in this page would otherwise close its own connections of that name first.
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(a.name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      off();
    }
    expect(events).toEqual([a.name]);
    expect(a.isOpen()).toBe(false);
    expect(a.stale).toBe(true);
    // the jobs stop here, and the closed handle stays the singleton so nothing in this tab reopens the database
    await until(() => peekQueue(a) === undefined);
    expect(peekDb(a.name)).toBe(a);
    await expect(ready(a)).rejects.toMatchObject({ name: 'DatabaseClosedError' });
    expect(await Dexie.exists(a.name)).toBe(false);
    await dropDb(a);
  });

  it('a delete that another connection keeps blocked says "Close other Sieve tabs" instead of hanging', async () => {
    const name = `sieve-test-blocked-${Math.random().toString(36).slice(2, 8)}`;
    // a connection that never answers versionchange (an older copy of Sieve in another tab)
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const blocked: string[] = [];
    const off = onIndexEvent((e) => {
      if (e.type === 'db-blocked') blocked.push(e.db);
    });
    try {
      await expect(deleteDbOrTimeout(name, 50)).rejects.toBeInstanceOf(DbBlockedError);
      await expect(deleteDbOrTimeout(name, 50)).rejects.toThrow('Close other Sieve tabs, then try again.');
    } finally {
      off();
    }
    expect(blocked.length).toBeGreaterThan(0);
    raw.close();   // the person closes the other tab: the queued delete finishes
    await until(async () => !(await Dexie.exists(name)));
  });
});
