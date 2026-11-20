// One indexer tab per database (20 section 4.4): Web Locks for leadership, BroadcastChannel for changes.
import type { SieveDb } from './db';

export type IndexBroadcast =
  | { type: 'keyword-saved'; updatedAt: number }
  | { type: 'records-changed'; ids: string[] }
  | { type: 'records-removed'; ids: string[] };

const channels = new Map<string, BroadcastChannel>();
const handlers = new Map<string, Set<(msg: IndexBroadcast) => void>>();
const leaders = new Map<string, boolean>();
const releases = new Map<string, () => void>();

function channelFor(db: SieveDb): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  let ch = channels.get(db.name);
  if (!ch) {
    ch = new BroadcastChannel('sieve-index:' + db.name);
    ch.onmessage = (ev: MessageEvent<IndexBroadcast>) => {
      for (const fn of handlers.get(db.name) ?? []) fn(ev.data);
    };
    channels.set(db.name, ch);
  }
  return ch;
}

export function broadcast(db: SieveDb, msg: IndexBroadcast): void {
  try {
    channelFor(db)?.postMessage(msg);
  } catch {
    // a closed channel during shutdown is fine
  }
}

/** Messages from other tabs about this database. */
export function onBroadcast(db: SieveDb, fn: (msg: IndexBroadcast) => void): () => void {
  channelFor(db);
  let set = handlers.get(db.name);
  if (!set) {
    set = new Set();
    handlers.set(db.name, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

export function isLeader(db: SieveDb): boolean {
  return leaders.get(db.name) === true;
}

interface LockManagerLike {
  request(name: string, opts: { ifAvailable?: boolean; signal?: AbortSignal }, cb: (lock: unknown) => Promise<void>): Promise<void>;
}

function lockManager(): LockManagerLike | undefined {
  return typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
}

/**
 * Leader runs source jobs, the ingest queue and keyword snapshot saves; followers answer from their own
 * memory and take over when the leader's lock is released. Without the Locks API (tests), this tab leads.
 */
export async function becomeIndexer(db: SieveDb, onLeader: () => void, onFollower: () => void): Promise<void> {
  if (leaders.get(db.name) === true) {
    onLeader();
    return;
  }
  const locks = lockManager();
  if (!locks) {
    leaders.set(db.name, true);
    onLeader();
    return;
  }
  const name = 'sieve-indexer:' + db.name;
  const hold = () =>
    new Promise<void>((resolve) => {
      releases.set(db.name, resolve);
      db.on('close', () => resolve());
    });
  const gotIt = await new Promise<boolean>((decided) => {
    void locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        decided(false);
        return;
      }
      leaders.set(db.name, true);
      onLeader();
      decided(true);
      await hold();
      leaders.set(db.name, false);
    });
  });
  if (gotIt) return;
  leaders.set(db.name, false);
  onFollower();
  // Wait in line to take over when the leader goes away.
  void locks.request(name, {}, async () => {
    leaders.set(db.name, true);
    onLeader();
    await hold();
    leaders.set(db.name, false);
  });
}

/** Releases leadership and the channel (wipeDb, tests). */
export function releaseIndexer(db: SieveDb): void {
  releases.get(db.name)?.();
  releases.delete(db.name);
  leaders.delete(db.name);
  const ch = channels.get(db.name);
  if (ch) {
    ch.close();
    channels.delete(db.name);
  }
  handlers.delete(db.name);
}
