// Two tabs on one database (20 section 4.4): two copies of the index and sources modules (vi.resetModules), one
// fake-indexeddb, and one Web Locks fake shared by both, so one copy is the indexer tab and the other a follower.
// Pause, Resume and Rebuild pressed in the follower reach the indexer tab's queue through the rows; the follower
// never starts a queue of its own; Gmail connected in the follower gets the indexer tab's 5-minute sync.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { until } from '../../../tests/harness/indexEnv';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));

/** navigator.locks for two "tabs" in one page: exclusive locks, ifAvailable, and a line of waiters. */
class FakeLocks {
  private held = new Set<string>();
  private lines = new Map<string, (() => void)[]>();
  async request(name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void> {
    if (this.held.has(name)) {
      if (opts.ifAvailable) return cb(null);
      await new Promise<void>((grant) => this.lines.set(name, [...(this.lines.get(name) ?? []), grant]));
    }
    this.held.add(name);
    try {
      await cb({ name });
    } finally {
      this.held.delete(name);
      const next = this.lines.get(name)?.shift();
      next?.();
    }
  }
  /** Tabs that closed drop their place in line. */
  dropWaiters(): void {
    this.lines.clear();
  }
}

const locks = new FakeLocks();

async function tab() {
  vi.resetModules();
  const [registry, db, lifecycle, lockMod, queue, ml, sync] = await Promise.all([
    import('./registry'),
    import('../index/db'),
    import('../index/lifecycle'),
    import('../index/locks'),
    import('../index/queue/ingestQueue'),
    import('../ml/client'),
    import('./gmail/sync'),
  ]);
  ml.setMlClient(createHashEmbedClient());
  return { registry, db, lifecycle, locks: lockMod, queue, sync };
}

beforeAll(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
});
afterAll(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

async function twoTabs() {
  const name = `sieve-test-tabs-${Math.random().toString(36).slice(2, 8)}`;
  const a = await tab();
  const b = await tab();
  const dbA = a.db.openDbNamed(name, 'real');
  const dbB = b.db.openDbNamed(name, 'real');
  cleanup = async () => {
    locks.dropWaiters();
    await b.lifecycle.closeDb(dbB, { flush: false });
    await a.lifecycle.closeDb(dbA, { flush: false });
    await dbA.delete();
  };
  return { a, b, dbA, dbB };
}

describe('two tabs on one database', () => {
  it('Pause and Resume in the follower tab reach the indexer tab, and the follower starts no queue', async () => {
    const { a, b, dbA, dbB } = await twoTabs();
    await dbA.sources.put({ kind: 'upload', connected: true, progress: { done: 0, total: 0 }, paused: false });
    await a.registry.startSources(dbA);
    await b.registry.startSources(dbB);
    expect(a.locks.isLeader(dbA)).toBe(true);
    expect(b.locks.isLeader(dbB)).toBe(false);
    const queue = a.queue.peekQueue(dbA);
    expect(queue).toBeDefined();
    expect(queue?.paused).toBe(false);

    await b.registry.setIndexingPaused(dbB, true);
    await until(() => queue?.paused === true);
    expect(await dbA.sources.get('upload')).toMatchObject({ paused: true, pausedBy: 'person' });

    await b.registry.setIndexingPaused(dbB, false);
    await until(() => queue?.paused === false);
    expect((await dbA.sources.get('upload'))?.pausedBy).toBeUndefined();
    expect(b.queue.peekQueue(dbB)).toBeUndefined();

    // Rebuild in the follower: run by the indexer tab, still no second queue
    await b.registry.rebuildIndex(dbB);
    expect(b.queue.peekQueue(dbB)).toBeUndefined();
  });

  it('a pause written before the indexer tab starts holds its queue', async () => {
    const { a, b, dbA, dbB } = await twoTabs();
    await dbB.sources.put({ kind: 'upload', connected: true, progress: { done: 0, total: 0 }, paused: true, pausedBy: 'person' });
    await a.registry.startSources(dbA);
    await b.registry.startSources(dbB);
    await until(() => a.queue.peekQueue(dbA)?.paused === true);
  });

  it('Gmail connected in the follower tab gets the 5-minute sync in the indexer tab', async () => {
    const { a, b, dbA, dbB } = await twoTabs();
    await a.registry.startSources(dbA);
    await b.registry.startSources(dbB);
    const timersA = vi.spyOn(a.sync, 'startGmailTimers');
    const timersB = vi.spyOn(b.sync, 'startGmailTimers');
    // what connectGmail in the follower writes once Google answered (the token is not needed for this check)
    await dbB.sources.put({ kind: 'gmail', connected: true, account: 'me@example.com', cursor: '1', progress: { done: 0, total: 0 }, paused: false, needsAuth: false, phase: 'idle' });
    await until(() => timersA.mock.calls.some(([db]) => db === dbA));
    expect(timersB).not.toHaveBeenCalled();
  });

  it('a follower keeps one place in line for the indexer lock, however often startSources runs', async () => {
    const { a, b, dbA, dbB } = await twoTabs();
    await a.locks.becomeIndexer(dbA, () => undefined, () => undefined);
    let led = 0;
    for (let i = 0; i < 3; i++) await b.locks.becomeIndexer(dbB, () => void led++, () => undefined);
    expect(b.locks.isLeader(dbB)).toBe(false);
    a.locks.releaseIndexer(dbA);   // the indexer tab closes
    await until(() => led === 1);
    expect(b.locks.isLeader(dbB)).toBe(true);
    b.locks.releaseIndexer(dbB);
    await new Promise((r) => setTimeout(r, 20));
    expect(led).toBe(1);   // no second or third leader turn for the same tab
  });

  it('stopSources (the Google session ended) stops the queue and the Gmail timers until startSources runs again', async () => {
    const { a, dbA } = await twoTabs();
    await a.registry.startSources(dbA);
    expect(a.queue.peekQueue(dbA)).toBeDefined();
    await a.registry.stopSources(dbA);
    expect(a.queue.peekQueue(dbA)).toBeUndefined();
    const timers = vi.spyOn(a.sync, 'startGmailTimers');
    await dbA.sources.put({ kind: 'gmail', connected: true, account: 'me@example.com', cursor: '1', progress: { done: 0, total: 0 }, paused: false, phase: 'idle' });
    await new Promise((r) => setTimeout(r, 50));
    expect(timers).not.toHaveBeenCalled();
    await a.registry.startSources(dbA);
    expect(a.queue.peekQueue(dbA)).toBeDefined();
    await until(() => timers.mock.calls.length > 0);
  });
});
