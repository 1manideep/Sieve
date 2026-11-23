// Where a call may run (10 section 8, decisions A8, 2 and 8). Own data never reaches the cloud silently: on-device only,
// unless cloud fallback is on (real data) or the person allowed the cloud for that file (Playground uploads).
import type { DataClass, InferenceModeName, NanoAvailability } from '@sieve/shared';
import type { SieveDb } from '@/index';
import type { ModelErrorCode, OwnCloudPolicy, Purpose } from './types';

export type Route =
  | { ok: true; mode: InferenceModeName; warning?: 'cloud-fallback' | 'sample-data-cloud' }
  | { ok: false; code: ModelErrorCode; message: string };

export interface ConsentRow {
  recordId: string;
  cloudAllowedAt: number;
}
interface ConsentTable {
  bulkGet(keys: string[]): Promise<(ConsentRow | undefined)[]>;
  bulkPut(rows: ConsentRow[]): Promise<unknown>;
}

/** The consents store of a Sieve database (01 section 5), or undefined when the handle has none. */
export function consentsOf(db: SieveDb): ConsentTable | undefined {
  const table = (db as unknown as { consents?: Partial<ConsentTable> }).consents;
  return table && typeof table.bulkGet === 'function' && typeof table.bulkPut === 'function' ? (table as ConsentTable) : undefined;
}

export const POLICY_MESSAGES = {
  draftNotApproved: 'Drafts are made only from text you approved.',
  notSetUp: 'The on-device model is not set up yet.',
  stillDownloading: 'The on-device model is still downloading.',
  noDevice: 'This Chrome has no on-device model.',
  ownCloudOff: 'Cloud fallback for your own data is off.',
  needsConsent: 'Your own data needs your OK before the cloud reads it.',
};

function deviceFailure(a: NanoAvailability): { code: ModelErrorCode; message: string } {
  if (a === 'downloadable') return { code: 'downloading', message: POLICY_MESSAGES.notSetUp };
  if (a === 'downloading') return { code: 'downloading', message: POLICY_MESSAGES.stillDownloading };
  return { code: 'unavailable', message: POLICY_MESSAGES.noDevice };
}

export function resolveRoute(input: {
  purpose: Purpose;
  data: DataClass;
  requestedMode: InferenceModeName;
  image: boolean;
  nano: { text: NanoAvailability; image: NanoAvailability };
  ownCloudAllowed: boolean;
  consentOk: boolean;
}): Route {
  const { purpose, data, requestedMode } = input;
  const availability = input.image ? input.nano.image : input.nano.text;
  const ready = availability === 'available';
  const fail = (): Route => ({ ok: false, ...deviceFailure(availability) });

  if (purpose === 'draft' && data !== 'approved') return { ok: false, code: 'cloud-not-allowed', message: POLICY_MESSAGES.draftNotApproved };
  if (purpose === 'draft') return { ok: true, mode: 'PREFER_IN_CLOUD' };
  if (purpose === 'pii-check') return ready ? { ok: true, mode: 'ONLY_ON_DEVICE' } : fail();
  // the question never leaves the device to find other words for it: without the on-device model the search runs as it is
  if (purpose === 'search-words') return ready ? { ok: true, mode: 'ONLY_ON_DEVICE' } : fail();
  // 10 section 12.3 step 12b: the check of the answer against the item never sends own data anywhere
  if ((purpose === 'verify-answer' || purpose === 'yes-no') && data === 'own') return ready ? { ok: true, mode: 'ONLY_ON_DEVICE' } : fail();
  // Own data always takes rows 6 to 10 (the caller's requested mode cannot widen or narrow them).
  if (data !== 'own') {
    if (requestedMode === 'ONLY_ON_DEVICE') return ready ? { ok: true, mode: 'ONLY_ON_DEVICE' } : fail();
    return ready ? { ok: true, mode: 'PREFER_ON_DEVICE' } : { ok: true, mode: 'ONLY_IN_CLOUD', warning: 'sample-data-cloud' };
  }
  if (ready) return { ok: true, mode: 'ONLY_ON_DEVICE' };
  if (purpose === 'label') return fail();
  if (!input.ownCloudAllowed) {
    const f = deviceFailure(availability);
    return { ok: false, code: f.code, message: `${f.message} ${POLICY_MESSAGES.ownCloudOff}` };
  }
  if (!input.consentOk) return { ok: false, code: 'needs-consent', message: POLICY_MESSAGES.needsConsent };
  return { ok: true, mode: 'ONLY_IN_CLOUD', warning: 'cloud-fallback' };
}

/** False for an empty list; otherwise every record has a consent row that is still fresh. */
export async function hasFreshConsent(policy: OwnCloudPolicy, recordIds: string[], now: number = Date.now()): Promise<boolean> {
  if (recordIds.length === 0) return false;
  const table = consentsOf(policy.db);
  if (!table) return false;
  const rows = await table.bulkGet(recordIds);
  return rows.every((row) => row !== undefined && (policy.maxAgeMs === null || now - row.cloudAllowedAt <= policy.maxAgeMs));
}
