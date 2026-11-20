// Cloud consent (10 section 12.5): the person's OK covers the exact text. getCloudConsentRequest returns the question
// and each passage exactly as it would be sent; grantCloudConsent records a consent row per file.
import { consentsOf } from '@/ai';
import type { SieveDb } from '@/index';
import type { CloudConsentRequest } from './types';

const KEEP_MS = 30 * 60 * 1000;   // relay requests expire while waiting; old requests are dropped (10 section 12.11)
const requests = new Map<string, CloudConsentRequest>();

function prune(now: number): void {
  for (const [id, r] of requests) if (now - r.createdAt > KEEP_MS) requests.delete(id);
}

export function getCloudConsentRequest(requestId: string): CloudConsentRequest | undefined {
  prune(Date.now());
  return requests.get(requestId);
}

export function rememberCloudConsentRequest(r: CloudConsentRequest): void {
  prune(Date.now());
  requests.set(r.requestId, r);
}

export function forgetCloudConsentRequest(requestId: string): void {
  requests.delete(requestId);
}

/** Records the person's OK for each record. In real data a row lasts CONSENT_MAX_AGE_MS; in the Playground until Reset. */
export async function grantCloudConsent(db: SieveDb, recordIds: string[], now: number = Date.now()): Promise<void> {
  const table = consentsOf(db);
  if (!table) throw new Error('This database has no consents store.');
  if (recordIds.length === 0) return;
  await table.bulkPut(recordIds.map((recordId) => ({ recordId, cloudAllowedAt: now })));
}

export function clearCloudConsentRequestsForTests(): void {
  requests.clear();
}
