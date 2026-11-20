// Breadth-first walk of the granted folder (20 section 16.3, 70 R-IDX-16). Paths are relative to the root.
import { FOLDER_MAX_ENTRIES } from '../../index/config';
import { fileTypeOf } from '../readers';
import type { SkipReason } from '../types';
import type { DirHandle, FileHandle } from './fsTypes';

export { fileTypeOf } from '../readers';

export interface FileEntry { path: string; name: string; handle: FileHandle; size: number; lastModified: number }
/** A supported file beyond the indexing cap: its path still counts for the deletion diff. */
export interface SeenOnly { seen: string }
export type WalkItem = FileEntry | { skipped: SkipReason; path: string } | SeenOnly | { tooBig: true };

const IGNORED_NAMES = new Set(['node_modules', '__MACOSX', '$RECYCLE.BIN', 'System Volume Information', 'Thumbs.db', 'desktop.ini']);

export function isIgnored(name: string, isDir: boolean): boolean {
  if (name.startsWith('.') || name.startsWith('~$') || IGNORED_NAMES.has(name)) return true;
  if (isDir) return /\.(photoslibrary|app|bundle|git)$/i.test(name);
  return /\.(tmp|part|crdownload)$/i.test(name);
}

/**
 * Yields supported files up to maxFiles, then one `limit` skip, then only paths (up to FOLDER_MAX_ENTRIES) so the
 * deletion diff stays complete for folders of that size; beyond it one `tooBig` item and the walk stops.
 */
export async function* walkFolder(root: DirHandle, opts: { maxDepth: number; maxFiles: number; signal?: AbortSignal }): AsyncGenerator<WalkItem> {
  const queue: { dir: DirHandle; prefix: string; depth: number }[] = [{ dir: root, prefix: '', depth: 0 }];
  let files = 0;
  let entries = 0;
  let limited = false;
  while (queue.length > 0) {
    const { dir, prefix, depth } = queue.shift() as { dir: DirHandle; prefix: string; depth: number };
    for await (const [name, handle] of dir.entries()) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const path = prefix + name;
      if (handle.kind === 'directory') {
        if (isIgnored(name, true)) continue;
        if (depth + 1 < opts.maxDepth) queue.push({ dir: handle, prefix: path + '/', depth: depth + 1 });
        continue;
      }
      if (isIgnored(name, false)) continue;
      const type = fileTypeOf(name);
      if (!type) continue;
      entries++;
      if (entries > FOLDER_MAX_ENTRIES) {
        yield { tooBig: true };
        return;
      }
      if (files >= opts.maxFiles) {
        if (!limited) {
          limited = true;
          yield { skipped: 'limit', path };
        }
        yield { seen: path };
        continue;
      }
      if (type === 'heic') {
        files++;
        yield { skipped: 'heic', path };
        continue;
      }
      const file = await handle.getFile();
      files++;
      yield { path, name, handle, size: file.size, lastModified: file.lastModified };
    }
  }
}
