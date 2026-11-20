// Fresh databases for index tests: a unique name per test, closed and deleted afterwards.
import { File as NodeFile } from 'node:buffer';
import { openDbNamed, type SieveDb } from '../../web/src/index/db';
import { closeDb } from '../../web/src/index/lifecycle';

let n = 0;

export function freshDb(kind: 'real' | 'playground' = 'real'): SieveDb {
  n++;
  return openDbNamed(`sieve-test-${process.pid}-${n}-${Math.random().toString(36).slice(2, 8)}`, kind);
}

export async function dropDb(db: SieveDb): Promise<void> {
  await closeDb(db, { flush: false });
  await db.delete();
}

/** A File that fake-indexeddb can store (jsdom's File does not survive structured cloning). */
export function nodeFile(content: string | Uint8Array, name: string, opts?: { type?: string; lastModified?: number }): File {
  return new NodeFile([typeof content === 'string' ? new TextEncoder().encode(content) : content], name, { type: opts?.type ?? '', lastModified: opts?.lastModified ?? Date.now() }) as unknown as File;
}

/** Poll until `fn` is true (background work that has no promise to await). */
export async function until(fn: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}
