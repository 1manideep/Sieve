// Folder rescans and change detection (20 section 16.4, 70 R-IDX-02, R-IDX-03, R-IDX-06, R-FILE-02, R-FILE-11 to 13).
// Deletions are found by diffing a complete walk against stored paths; moves keep their derived fields.
import type { IndexRecord } from '@sieve/shared';
import { FOLDER_FOCUS_RESCAN_MS, FOLDER_MAX_DEPTH, FOLDER_MAX_FILES, FOLDER_RESCAN_MS, SOURCE_REF_MAX_CHARS } from '../../index/config';
import { removeRecord, removeRecords, writeIfCurrentDetailed } from '../../index/consistency';
import type { SieveDb, SourceInventory, SourceRow } from '../../index/db';
import { blobBytes, sha256Hex } from '../../index/hash';
import { IngestError, ingestInternal, type RawItem } from '../../index/ingest';
import { isLeader } from '../../index/locks';
import { getRuntime } from '../../index/runtime';
import { fileTypeOf, maxBytesFor, readFileForIndex, type FileType } from '../readers';
import { SOURCE_COPY, type SkipReason } from '../types';
import { permissionOf } from './connect';
import { asDir, type DirHandle } from './fsTypes';
import { walkFolder, type FileEntry } from './walk';

class Stop extends Error {
  constructor(readonly code: 'permission' | 'missing' | 'paused' | 'aborted') {
    super(code);
  }
}

/** The card's word for a file type: "7 PDFs, 3 notes, 12 photos" (20 section 13.5). */
function inventoryKind(type: FileType): keyof SourceInventory {
  if (type === 'pdf') return 'pdfs';
  if (type === 'text' || type === 'markdown') return 'notes';
  if (type === 'json') return 'files';
  return 'photos';
}

function errName(e: unknown): string {
  return (e as { name?: string })?.name ?? '';
}

async function rawFromFile(path: string, file: File, type: FileType): Promise<{ raw: RawItem | null; skip?: SkipReason; noText?: boolean }> {
  const r = await readFileForIndex(file, type);
  if (r.skip) return { raw: null, skip: r.skip };
  const raw: RawItem = {
    source: 'folder', sourceRef: path, kind: r.kind, title: file.name, date: r.date ?? file.lastModified,
    text: r.kind === 'photo' ? undefined : r.text ?? '', blob: r.kind === 'photo' ? file : undefined,
  };
  return { raw, noText: r.noText };
}

/** verifyFresh found new bytes at the same path: re-index in place (20 section 5.5). */
export async function reindexFolderFile(db: SieveDb, rec: IndexRecord, file: File, hash: string): Promise<'ok' | 'gone'> {
  const path = rec.sourceRef;
  const type = fileTypeOf(path);
  if (!type) {
    await removeRecord(db, rec.id, 'source-deleted');
    return 'gone';
  }
  const { raw } = await rawFromFile(path, file, type);
  if (!raw) {
    await removeRecord(db, rec.id, 'source-deleted');
    return 'gone';
  }
  await ingestInternal(db, raw, 'own', { contentHash: hash, sizeBytes: file.size, sourceModifiedAt: file.lastModified, photo: { storeBlob: false }, priority: 'high' });
  return 'ok';
}

const pausedDbs = new Set<SieveDb>();
export function setFolderPaused(db: SieveDb, paused: boolean): void {
  if (paused) pausedDbs.add(db);
  else pausedDbs.delete(db);
}

const running = new Map<SieveDb, Promise<void>>();

/** One scan at a time per database. */
export function scanFolder(db: SieveDb, opts?: { signal?: AbortSignal }): Promise<void> {
  const cur = running.get(db);
  if (cur) return cur;
  const p = doScan(db, opts?.signal).finally(() => running.delete(db));
  running.set(db, p);
  return p;
}

async function doScan(db: SieveDb, signal?: AbortSignal): Promise<void> {
  const row = await db.sources.get('folder');
  if (!row?.connected || !row.folderHandle || row.paused) return;
  const root: DirHandle = asDir(row.folderHandle);
  const name = row.folderName ?? root.name;
  const perm = await permissionOf(root);
  if (perm !== 'granted') {
    await db.sources.update('folder', { errorCode: 'permission-needed', error: perm === 'denied' ? SOURCE_COPY.folderPickAgain : SOURCE_COPY.folderPermission(name), needsAuth: true, phase: 'idle' });
    return;
  }
  const rt = getRuntime(db);
  const jobStartedAt = Date.now();
  const skipped: Partial<Record<SkipReason, number>> = {};
  const skip = (r: SkipReason) => {
    skipped[r] = (skipped[r] ?? 0) + 1;
  };
  const patch = async (p: Partial<SourceRow>) => {
    try {
      await db.sources.update('folder', p);
    } catch {
      // closing
    }
  };
  await patch({ phase: 'scanning' });

  // pass 1: walk fully. While it walks, the total only grows and the card says "so far" (20 section 13.5).
  const entries: FileEntry[] = [];
  const seen = new Set<string>();
  let complete = true;
  let tooBig = false;
  const storedCount = await db.records.where('source').equals('folder').count();
  const listing = () => {
    rt.syncProgress.set('folder', { discovered: entries.length, remaining: Math.max(0, entries.length - storedCount), listing: true });
    void rt.queue?.writeRowsNow?.();
  };
  listing();
  try {
    for await (const item of walkFolder(root, { maxDepth: FOLDER_MAX_DEPTH, maxFiles: FOLDER_MAX_FILES, signal })) {
      if ('tooBig' in item) {
        tooBig = true;
        complete = false;
        break;
      }
      if ('seen' in item) {
        seen.add('folder:' + item.seen);
        continue;
      }
      if ('skipped' in item) {
        seen.add('folder:' + item.path);
        skip(item.skipped);
        continue;
      }
      seen.add('folder:' + item.path);
      entries.push(item);
      if (entries.length % 200 === 0) listing();
    }
  } catch (e) {
    const n = errName(e);
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'NotFoundError' || n === 'AbortError') {
      rt.syncProgress.delete('folder');
      void rt.queue?.writeRowsNow?.();
    }
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      await patch({ errorCode: 'permission-needed', error: SOURCE_COPY.folderPermission(name), needsAuth: true, phase: 'idle' });
      return;
    }
    if (n === 'NotFoundError') {
      await patch({ errorCode: 'folder-missing', error: SOURCE_COPY.folderMissing, phase: 'idle' });
      return;
    }
    if (n === 'AbortError') return;
    complete = false;
  }
  // moves, then deletions (01 invariant 5: before indexing new files)
  const stored = new Map<string, IndexRecord>();
  await db.records.where('source').equals('folder').each((r) => {
    stored.set(r.id, r);
  });

  // The inventory, before any model work (20 section 13.5): the files this scan will read, by kind, and the row's
  // progress total. Unchanged files take the fast path in pass 2 and are not counted as left to read.
  const readable = (e: FileEntry): boolean => {
    const type = fileTypeOf(e.name);
    if (!type || e.size > maxBytesFor(type) || e.path.length > SOURCE_REF_MAX_CHARS) return false;
    const rec = stored.get('folder:' + e.path);
    return !(rec && rec.sizeBytes === e.size && rec.sourceModifiedAt === e.lastModified);
  };
  const toRead = new Set<string>();
  const inventory: SourceInventory = {};
  for (const e of entries) {
    if (!readable(e)) continue;
    toRead.add(e.path);
    const k = inventoryKind(fileTypeOf(e.name) as FileType);
    inventory[k] = (inventory[k] ?? 0) + 1;
  }
  await patch({ inventory });
  rt.syncProgress.set('folder', { discovered: entries.length, remaining: toRead.size });
  await rt.queue?.writeRowsNow?.();
  const vanished = complete ? [...stored.values()].filter((r) => !seen.has(r.id)) : [];
  const moved = new Set<string>();
  if (vanished.length > 0) {
    const bySize = new Map<number, IndexRecord[]>();
    for (const r of vanished) bySize.set(r.sizeBytes, [...(bySize.get(r.sizeBytes) ?? []), r]);
    for (const e of entries) {
      if (stored.has('folder:' + e.path)) continue;
      const cands = bySize.get(e.size);
      if (!cands || cands.length === 0) continue;
      try {
        const file = await e.handle.getFile();
        const hash = await sha256Hex(await blobBytes(file));
        const old = cands.find((r) => r.contentHash === hash && !moved.has(r.id));
        if (!old) continue;
        const type = fileTypeOf(e.name);
        if (!type) continue;
        const { raw } = await rawFromFile(e.path, file, type);
        if (!raw) continue;
        const rec = await ingestInternal(db, raw, 'own', { contentHash: hash, sizeBytes: file.size, sourceModifiedAt: e.lastModified, photo: { storeBlob: false }, movedFrom: old, deferSave: true });
        if (rec) {
          await removeRecord(db, old.id, 'moved', { movedTo: rec.id });
          moved.add(old.id);
          stored.set(rec.id, rec);
        }
      } catch {
        // not a move after all; pass 2 indexes it
      }
    }
  }
  const gone = vanished.filter((r) => !moved.has(r.id)).map((r) => r.id);
  if (gone.length > 0) await removeRecords(db, gone, 'source-deleted');

  // pass 2: newest first
  entries.sort((a, b) => b.lastModified - a.lastModified);
  let remaining = toRead.size;
  try {
    for (const e of entries) {
      if (signal?.aborted) throw new Stop('aborted');
      if (pausedDbs.has(db)) throw new Stop('paused');
      if (toRead.has(e.path)) {
        remaining--;
        rt.syncProgress.set('folder', { discovered: entries.length, remaining });
      }
      const id = 'folder:' + e.path;
      if (e.path.length > SOURCE_REF_MAX_CHARS) {
        skip('limit');
        continue;
      }
      const type = fileTypeOf(e.name);
      if (!type) continue;
      if (e.size > maxBytesFor(type)) {
        skip('too-large');
        continue;
      }
      const rec = stored.get(id);
      if (rec && rec.sizeBytes === e.size && rec.sourceModifiedAt === e.lastModified) continue;   // fast path
      try {
        const file = await e.handle.getFile();
        const hash = await sha256Hex(await blobBytes(file));
        if (rec && rec.contentHash === hash) {
          await writeIfCurrentDetailed(db, id, rec.version, () => ({ sourceModifiedAt: e.lastModified }));
          continue;
        }
        const r = await rawFromFile(e.path, file, type);
        if (!r.raw) {
          if (r.skip) skip(r.skip);
          continue;
        }
        if (r.noText) skip('no-text');
        await ingestInternal(db, r.raw, 'own', { contentHash: hash, sizeBytes: file.size, sourceModifiedAt: e.lastModified, photo: { storeBlob: false }, notTombstonedSince: jobStartedAt, deferSave: true });
      } catch (err) {
        const n = errName(err);
        if (n === 'NotReadableError' || n === 'NotFoundError') continue;   // changed while reading: next rescan
        if (n === 'NotAllowedError' || n === 'SecurityError') throw new Stop('permission');
        if (err instanceof IngestError) {
          if (err.code === 'storage-full') throw err;
          skip(err.code === 'invalid' ? 'unreadable' : err.code);
          continue;
        }
        skip('unreadable');
      }
    }
  } catch (e) {
    rt.syncProgress.delete('folder');
    await rt.keyword.flush();
    if (e instanceof Stop && e.code === 'permission') {
      await patch({ errorCode: 'permission-needed', error: SOURCE_COPY.folderPermission(name), needsAuth: true, phase: 'idle', skipped });
      return;
    }
    if (e instanceof Stop) {
      await patch({ phase: 'idle', skipped });
      return;
    }
    if (e instanceof IngestError && e.code === 'storage-full') return;
    throw e;
  }
  rt.syncProgress.delete('folder');
  await rt.keyword.flush();
  const done: Partial<SourceRow> = { phase: 'idle', lastSyncAt: Date.now(), skipped, needsAuth: false };
  if (tooBig) Object.assign(done, { error: SOURCE_COPY.folderTooBig, errorCode: 'unknown' as const });
  else Object.assign(done, { error: undefined, errorCode: undefined });
  await patch(done);
}

// ---------- triggers ----------

interface Timers { interval: ReturnType<typeof setInterval>; onFocus: () => void; last: number }
const timers = new Map<SieveDb, Timers>();

/** Rescans every FOLDER_RESCAN_MS and on focus or visibility (at most every 2 minutes), leader only. */
export function startFolderTimers(db: SieveDb): void {
  if (timers.has(db)) return;
  const t: Timers = {
    last: Date.now(),
    interval: setInterval(() => {
      if (isLeader(db)) void scanFolder(db);
    }, FOLDER_RESCAN_MS),
    onFocus: () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - t.last < FOLDER_FOCUS_RESCAN_MS || !isLeader(db)) return;
      t.last = Date.now();
      void scanFolder(db);
    },
  };
  timers.set(db, t);
  if (typeof window !== 'undefined') window.addEventListener('focus', t.onFocus);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', t.onFocus);
  getRuntime(db).stoppers.add(() => stopFolderTimers(db));
}

export function stopFolderTimers(db: SieveDb): void {
  const t = timers.get(db);
  if (!t) return;
  clearInterval(t.interval);
  if (typeof window !== 'undefined') window.removeEventListener('focus', t.onFocus);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', t.onFocus);
  timers.delete(db);
}
