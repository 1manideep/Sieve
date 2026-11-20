// Calls into the index package (20) that the pipeline wraps so a failure there never fails a proposal.
import { getPhotoBlob, patchRecord, type SieveDb } from '@/index';
import type { IndexRecord } from '@sieve/shared';

/** Persists a share-time scan result with 20's version-checked write (contracts section 10, invariant 6). */
export async function patchRecordIfCurrent(db: SieveDb, record: IndexRecord, patch: Partial<IndexRecord>): Promise<boolean> {
  try {
    return (await patchRecord(db, record.id, record.version, patch)) === 'ok';
  } catch (e) {
    console.warn('Sieve: a share-time scan result was not saved.', e instanceof Error ? e.name : e);
    return false;
  }
}

/** The stored photo for sharing (20's getPhotoBlob); undefined when it cannot be read, so the photo step says so. */
export async function photoBlobFor(db: SieveDb, recordId: string): Promise<Blob | undefined> {
  try {
    return await getPhotoBlob(db, recordId);
  } catch {
    return undefined;
  }
}
