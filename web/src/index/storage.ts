// Persistence and quota (20 section 4.3).
import { STORAGE_PAUSE_RATIO } from './config';

export interface StorageStatus { persisted: boolean | 'unsupported'; usage?: number; quota?: number; ratio?: number }

function storageManager(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined;
}

/** Ask Chrome to keep Sieve's data. Real sources only, never the Playground. */
export async function requestPersistence(): Promise<boolean> {
  const sm = storageManager();
  if (!sm?.persist) return false;
  try {
    if (await sm.persisted?.()) return true;
    return await sm.persist();
  } catch {
    return false;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const sm = storageManager();
  if (!sm) return { persisted: 'unsupported' };
  let persisted: boolean | 'unsupported' = 'unsupported';
  try {
    if (sm.persisted) persisted = await sm.persisted();
  } catch {
    persisted = 'unsupported';
  }
  try {
    const est = await sm.estimate?.();
    if (!est) return { persisted };
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    return { persisted, usage, quota, ratio: quota > 0 ? usage / quota : undefined };
  } catch {
    return { persisted };
  }
}

/** ok when (usage + n) / quota stays under STORAGE_PAUSE_RATIO; unknown quota counts as ok. */
export async function ensureSpace(bytesNeeded: number): Promise<{ ok: boolean; status: StorageStatus }> {
  const status = await getStorageStatus();
  if (!status.quota || status.usage === undefined) return { ok: true, status };
  return { ok: (status.usage + bytesNeeded) / status.quota < STORAGE_PAUSE_RATIO, status };
}

export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; inner?: { name?: string } };
  return err.name === 'QuotaExceededError' || err.inner?.name === 'QuotaExceededError';
}
