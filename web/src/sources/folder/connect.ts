// Connecting the local folder and reading one file of it (20 sections 16.1 and 16.2).
import { removeRecords } from '../../index/consistency';
import type { SieveDb } from '../../index/db';
import { requestPersistence } from '../../index/storage';
import { SOURCE_COPY } from '../types';
import { asDir, asStored, directoryPicker, type DirHandle, type FileHandle, type FsPermission } from './fsTypes';

export class PermissionNeededError extends Error {
  constructor(message = 'Sieve needs your OK to read the folder again.') {
    super(message);
    this.name = 'PermissionNeededError';
  }
}

export async function permissionOf(handle: DirHandle): Promise<FsPermission> {
  if (!handle.queryPermission) return 'granted';
  try {
    return await handle.queryPermission({ mode: 'read' });
  } catch {
    return 'prompt';
  }
}

/** Inside a click handler. A dismissed picker (or a folder Chrome refuses) leaves the row and returns quietly. */
export async function pickFolder(db: SieveDb): Promise<DirHandle | null> {
  const pick = directoryPicker();
  if (!pick) {
    await db.sources.put({ ...(await db.sources.get('folder') ?? { kind: 'folder', connected: false, progress: { done: 0, total: 0 }, paused: false }), error: SOURCE_COPY.noFolderApi, errorCode: 'unknown' });
    return null;
  }
  let handle: DirHandle;
  try {
    handle = await pick({ id: 'sieve-folder', mode: 'read', startIn: 'pictures' });
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') {
      const row = await db.sources.get('folder');
      if (row) await db.sources.update('folder', { error: SOURCE_COPY.noFolder });
      else await db.sources.put({ kind: 'folder', connected: false, progress: { done: 0, total: 0 }, paused: false, error: SOURCE_COPY.noFolder });
      return null;
    }
    throw e;
  }
  const prev = await db.sources.get('folder');
  if (prev?.connected && prev.folderHandle) {
    const ids = (await db.records.where('source').equals('folder').primaryKeys()) as string[];
    await removeRecords(db, ids, 'disconnected');
  }
  await db.sources.put({ kind: 'folder', connected: true, folderHandle: asStored(handle), folderName: handle.name, paused: false, progress: { done: 0, total: 0 } });
  if (db.sieveKind === 'real') void requestPersistence();
  return handle;
}

async function resolvePath(root: DirHandle, path: string): Promise<FileHandle> {
  const parts = path.split('/').filter(Boolean);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return dir.getFileHandle(parts[parts.length - 1] ?? '');
}

/** The current bytes of a folder record. Throws PermissionNeededError or DOMException NotFoundError. */
export async function readFolderFile(db: SieveDb, recordId: string): Promise<File> {
  const row = await db.sources.get('folder');
  if (!row?.folderHandle) throw new DOMException('The folder is not connected.', 'NotFoundError');
  const root = asDir(row.folderHandle);
  if ((await permissionOf(root)) !== 'granted') throw new PermissionNeededError();
  const path = recordId.startsWith('folder:') ? recordId.slice('folder:'.length) : recordId;
  try {
    const fh = await resolvePath(root, path);
    return await fh.getFile();
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new PermissionNeededError();
    if (name === 'NotFoundError' || name === 'TypeMismatchError') throw new DOMException('That file is no longer in the folder.', 'NotFoundError');
    throw e;
  }
}
