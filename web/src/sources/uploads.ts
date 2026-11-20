// Files the person adds (20 section 17): up to 5 at a time, 10 MB each, stored on this device only.
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_FILES } from '../index/config';
import type { SieveDb } from '../index/db';
import { blobBytes, sha256Hex } from '../index/hash';
import { IngestError, ingestInternal } from '../index/ingest';
import { ensureSpace, requestPersistence } from '../index/storage';
import { fileTypeOf, isImageType, typeFromMime } from './readers';
import type { SkipReason } from './types';

export interface UploadResult { fileName: string; status: 'indexed' | 'duplicate' | 'rejected'; reason?: SkipReason | 'storage-full' | 'too-many'; recordId?: string }

export async function addUploads(db: SieveDb, files: File[] | FileList, _data: 'own' = 'own'): Promise<UploadResult[]> {
  const list = Array.from(files as ArrayLike<File>);
  const results: UploadResult[] = [];
  if (list.length > 0 && !(await db.sources.get('upload'))) {
    await db.sources.put({ kind: 'upload', connected: true, progress: { done: 0, total: 0 }, paused: false });
    if (db.sieveKind === 'real') void requestPersistence();
  }
  for (const [i, file] of list.entries()) {
    if (i >= UPLOAD_MAX_FILES) {
      results.push({ fileName: file.name, status: 'rejected', reason: 'too-many' });
      continue;
    }
    const type = fileTypeOf(file.name) ?? typeFromMime(file.type);
    if (!type) {
      results.push({ fileName: file.name, status: 'rejected', reason: 'unsupported' });
      continue;
    }
    if (type === 'heic') {
      results.push({ fileName: file.name, status: 'rejected', reason: 'heic' });
      continue;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      results.push({ fileName: file.name, status: 'rejected', reason: 'too-large' });
      continue;
    }
    if (!(await ensureSpace(file.size * 2)).ok) {
      results.push({ fileName: file.name, status: 'rejected', reason: 'storage-full' });
      continue;
    }
    try {
      const contentHash = await sha256Hex(await blobBytes(file));
      let dup: string | undefined;
      await db.records.where('source').equals('upload').each((r) => {
        if (!dup && r.contentHash === contentHash) dup = r.id;
      });
      if (dup) {
        results.push({ fileName: file.name, status: 'duplicate', recordId: dup });
        continue;
      }
      const rec = await ingestInternal(db, {
        source: 'upload', sourceRef: 'upload-' + crypto.randomUUID(), kind: isImageType(type) ? 'photo' : 'document',
        title: file.name, date: file.lastModified || Date.now(), blob: file,
      }, 'own', { contentHash, sizeBytes: file.size, priority: 'high' });
      if (rec) results.push({ fileName: file.name, status: 'indexed', recordId: rec.id });
      else results.push({ fileName: file.name, status: 'rejected', reason: 'unreadable' });
    } catch (e) {
      if (e instanceof IngestError) {
        const reason: UploadResult['reason'] = e.code === 'storage-full' ? 'storage-full' : e.code === 'invalid' ? 'unreadable' : e.code;
        results.push({ fileName: file.name, status: 'rejected', reason });
      } else {
        results.push({ fileName: file.name, status: 'rejected', reason: 'unreadable' });
      }
    }
  }
  return results;
}

/** Files from a drop; folders are counted and refused ("Drop files, not folders."). */
export function filesFromDataTransfer(dt: DataTransfer): { files: File[]; rejectedFolders: number } {
  const files: File[] = [];
  let rejectedFolders = 0;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      rejectedFolders++;
      continue;
    }
    const f = item.getAsFile();
    if (f) files.push(f);
  }
  if (files.length === 0 && rejectedFolders === 0) files.push(...Array.from(dt.files ?? []));
  return { files, rejectedFolders };
}
