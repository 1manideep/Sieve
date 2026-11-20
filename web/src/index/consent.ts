// Per-file cloud consent (20 section 12.4). Ingest never causes a cloud call for own data.
import type { SieveDb } from './db';
import { getRuntime } from './runtime';

export async function grantCloudConsent(db: SieveDb, recordId: string): Promise<void> {
  await db.consents.put({ recordId, cloudAllowedAt: Date.now() });
  getRuntime(db).queue?.enqueue([recordId], { priority: 'high' });   // the caption stage re-checks consent
}

export async function revokeCloudConsent(db: SieveDb, recordId: string): Promise<void> {
  await db.consents.delete(recordId);
}

export async function hasCloudConsent(db: SieveDb, recordId: string): Promise<boolean> {
  return (await db.consents.get(recordId)) !== undefined;
}
