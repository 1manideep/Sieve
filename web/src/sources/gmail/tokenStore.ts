// The Gmail access token on this device (20 section 15.1, Nov 20). One field on the real database's Gmail row, so
// every tab of this account shares the token for its lifetime (up to an hour) and a reload keeps it. Dexie keeps a
// field that is not indexed without a schema change. Never in the Playground database, Firestore, a URL or a log.
import type { SieveDb, SourceRow } from '../../index/db';
import { adoptGmailToken, getGmailToken, isUsableGmailToken, type GmailToken } from './auth';

/** The Gmail row with the token field this module adds. */
export type GmailRow = SourceRow & { accessToken?: GmailToken };

function patchGmailRow(db: SieveDb, patch: Partial<GmailRow>): Promise<number> {
  return db.sources.update('gmail', patch as Partial<SourceRow>);
}

/** The token kept on the row, as stored (it may have run out). */
export function storedTokenOf(row: object | undefined): GmailToken | null {
  const t = (row as { accessToken?: Partial<GmailToken> | null } | undefined)?.accessToken;
  if (!t || typeof t.value !== 'string' || typeof t.expiresAt !== 'number') return null;
  return { value: t.value, expiresAt: t.expiresAt, scope: typeof t.scope === 'string' ? t.scope : '' };
}

/** The usable token on the row, or null. A spent, refused or scope-less token is removed from the row. */
export async function readStoredToken(db: SieveDb): Promise<GmailToken | null> {
  if (db.sieveKind !== 'real') return null;
  const t = storedTokenOf(await db.sources.get('gmail'));
  if (!t) return null;
  const { value } = t;
  if (isUsableGmailToken(t)) return t;
  await clearStoredToken(db, value);
  return null;
}

/** Keeps the token on the row (real database only), with any other fields of the same write. */
export async function writeStoredToken(db: SieveDb, t: GmailToken | null, patch: Partial<SourceRow> = {}): Promise<void> {
  const full: Partial<GmailRow> = db.sieveKind === 'real' && t ? { ...patch, accessToken: t } : patch;
  if (Object.keys(full).length > 0) await patchGmailRow(db, full);
}

/** Removes the stored token; with `onlyValue`, only when that is the token stored (another tab may have renewed it). */
export async function clearStoredToken(db: SieveDb, onlyValue?: string): Promise<void> {
  if (db.sieveKind !== 'real') return;
  await db.transaction('rw', db.sources, async () => {
    const t = storedTokenOf(await db.sources.get('gmail'));
    if (!t || (onlyValue !== undefined && t.value !== onlyValue)) return;
    await patchGmailRow(db, { accessToken: undefined });
  });
}

/** Reads the row and holds its token when it is usable; the token this tab can use now, or null. */
export async function loadStoredGmailToken(db: SieveDb): Promise<string | null> {
  const t = await readStoredToken(db);
  if (t) adoptGmailToken(t);
  return getGmailToken();
}
