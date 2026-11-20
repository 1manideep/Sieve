// The audit log check (40 section 9.11, 30 section 13.1): the server verifies the Ratchet chain with Ratchet's hashing.
import { getAuditStatus } from './callables';

export interface AuditCheck {
  state: 'intact' | 'broken';
  entries: number;
  checkedAt: number;
  brokenAt?: number;
}

/** "Log intact" only when the chain verified and was not truncated (30 section 13.1). */
export async function checkAudit(): Promise<AuditCheck> {
  const r = await getAuditStatus();
  const intact = r.intact === true && r.truncated !== true;
  return {
    state: intact ? 'intact' : 'broken',
    entries: typeof r.entries === 'number' ? r.entries : 0,
    checkedAt: typeof r.checkedAt === 'number' ? r.checkedAt : Date.now(),
    ...(!intact && typeof r.brokenAtSeq === 'number' ? { brokenAt: r.brokenAtSeq } : {}),
  };
}
