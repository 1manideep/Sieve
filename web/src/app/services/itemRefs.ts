// Item refs (01 section 11.8): no file paths or item ids in Firestore. Receipts store `itemRefs` and blocked docs a
// `recordRef`: HMAC-SHA256(localSalt, recordId) as lowercase hex. The salt is 32 random bytes kept only in this
// browser's IndexedDB (database 'sieve-keys', one salt per account), so ids and titles are joined on the device.
import type { SieveDb } from '@/index';
import { tables } from '@/state/localDb';

const KEYS_DB = 'sieve-keys';
const STORE = 'salts';
const REF_RE = /^[0-9a-f]{64}$/;

const keys = new Map<string, Promise<CryptoKey>>();
const refCache = new Map<string, Map<string, string>>();   // uid -> recordId -> ref

/** True for a stored ref (64 lowercase hex). Record ids always contain ':' (`${source}:${sourceRef}`), refs never. */
export function isItemRef(value: string): boolean {
  return REF_RE.test(value);
}

function openKeysDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEYS_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = body(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** A stored 32-byte salt (checked by tag, not instanceof: IndexedDB may hand back another realm's typed array). */
function asSalt(value: unknown): Uint8Array | null {
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Uint8Array]' && (value as Uint8Array).length === 32) return new Uint8Array(value as Uint8Array);
  if (tag === '[object ArrayBuffer]' && (value as ArrayBuffer).byteLength === 32) return new Uint8Array(value as ArrayBuffer);
  return null;
}

async function loadSalt(uid: string): Promise<Uint8Array> {
  const db = await openKeysDb();
  try {
    const existing = asSalt(await run<unknown>(db, 'readonly', (s) => s.get(uid)));
    if (existing) return existing;
    const salt = crypto.getRandomValues(new Uint8Array(32));
    // add() fails if another tab stored a salt meanwhile; then read the winner.
    try {
      await run(db, 'readwrite', (s) => s.add(salt, uid));
      return salt;
    } catch {
      const winner = asSalt(await run<unknown>(db, 'readonly', (s) => s.get(uid)));
      if (winner) return winner;
      throw new Error('Could not keep the local salt');
    }
  } finally {
    db.close();
  }
}

function hmacKey(uid: string): Promise<CryptoKey> {
  let key = keys.get(uid);
  if (!key) {
    key = loadSalt(uid).then((salt) =>
      crypto.subtle.importKey('raw', salt as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    );
    key.catch(() => keys.delete(uid));
    keys.set(uid, key);
  }
  return key;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function cacheFor(uid: string): Map<string, string> {
  let cache = refCache.get(uid);
  if (!cache) {
    cache = new Map();
    refCache.set(uid, cache);
  }
  return cache;
}

/** The Firestore form of one record id. A value that is already a ref (from another device) is returned as is. */
export async function itemRef(uid: string, recordId: string): Promise<string> {
  if (isItemRef(recordId)) return recordId;
  const cache = cacheFor(uid);
  const hit = cache.get(recordId);
  if (hit) return hit;
  const key = await hmacKey(uid);
  const ref = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(recordId)));
  cache.set(recordId, ref);
  return ref;
}

export function itemRefs(uid: string, recordIds: string[]): Promise<string[]> {
  return Promise.all(recordIds.map((id) => itemRef(uid, id)));
}

/**
 * Maps refs back to record ids on this device: the ref of every local record id is computed (and cached), then
 * looked up. A ref with no local record maps to null (made on another computer, or the item is gone).
 */
export async function resolveItemRefs(uid: string, db: SieveDb, refs: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const wanted = refs.filter((r) => isItemRef(r));
  for (const r of refs) if (!isItemRef(r)) out[r] = r;   // already an id (local-only data)
  if (wanted.length === 0) return out;
  const cache = cacheFor(uid);
  const byRef = new Map<string, string>();
  for (const [id, ref] of cache) byRef.set(ref, id);
  if (wanted.some((r) => !byRef.has(r))) {
    const ids = (await tables(db).records.toCollection().primaryKeys()).map(String);
    // 70 R-IDX-06: an id that moved keeps its ref, so a block set on the old path still resolves and expandMoved
    // (robust/media.ts) can follow the tombstone to the new id
    const tomb = (db as unknown as { tombstones?: { toArray(): Promise<{ id: string; movedTo?: string }[]> } }).tombstones;
    const moved = tomb ? await tomb.toArray().catch(() => []) : [];
    for (const t of moved) if (t.movedTo) ids.push(t.id);
    for (const id of ids) {
      if (cache.has(id)) continue;
      const ref = await itemRef(uid, id);
      byRef.set(ref, id);
    }
  }
  for (const r of wanted) out[r] = byRef.get(r) ?? null;
  return out;
}

/** Deletes this account's salt from the browser (Delete my account). Old refs can no longer be joined here. */
export async function forgetLocalSalt(uid: string): Promise<void> {
  keys.delete(uid);
  refCache.delete(uid);
  const db = await openKeysDb();
  try {
    await run(db, 'readwrite', (s) => s.delete(uid));
  } finally {
    db.close();
  }
}

/** Test seam: forget cached keys and refs (the stored salt stays). */
export function resetItemRefsForTests(): void {
  keys.clear();
  refCache.clear();
}
