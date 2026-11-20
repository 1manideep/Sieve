// Early renewal inside the person's own clicks (20 section 15.1, Nov 20). While Gmail is connected, one click
// listener on the document asks Google Identity Services for a new token (prompt '') when the token has less than
// GMAIL_RENEW_BEFORE_MS left, at most once per GMAIL_RENEW_EVERY_MS. Never the Firebase popup: that opens only from
// the card's own Continue button, because a surprise popup is worse than a notice.
import type { SieveDb } from '../../index/db';
import { gisAvailable, gmailTokenExpiresAt, gmailTokenRequestOpen, requestGmailToken } from './auth';

export const GMAIL_RENEW_BEFORE_MS = 10 * 60_000;
export const GMAIL_RENEW_EVERY_MS = 5 * 60_000;

export interface RenewTarget {
  db: SieveDb;
  account?: string;
  /** When the stored token ends; kept after it ran out by time, null once it was refused, signed out or never there. */
  expiresAt: number | null;
  /** Paused, or Google refused a fresh token: only Continue may ask. */
  blocked: boolean;
  /** Keep the new token and sync (the registry). */
  onToken: (db: SieveDb) => Promise<void>;
}

let target: RenewTarget | null = null;
let lastAttempt = Number.NEGATIVE_INFINITY;
let listening = false;

function onDocumentClick(): void {
  void renewInClick()?.catch(() => undefined);
}

/**
 * Runs synchronously inside the click, so the Google popup keeps the user activation. The request's promise, or null
 * when nothing was asked.
 */
export function renewInClick(now = Date.now()): Promise<void> | null {
  const t = target;
  if (!t || t.blocked || !gisAvailable() || gmailTokenRequestOpen()) return null;
  const ends = Math.max(gmailTokenExpiresAt() ?? Number.NEGATIVE_INFINITY, t.expiresAt ?? Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(ends) || ends - now > GMAIL_RENEW_BEFORE_MS) return null;
  if (now - lastAttempt < GMAIL_RENEW_EVERY_MS) return null;
  lastAttempt = now;
  // A failed renewal says nothing: the card's note and Continue are still there.
  return requestGmailToken({ prompt: '', loginHint: t.account }).then(() => t.onToken(t.db));
}

/** The connected Gmail source the clicks renew for, or null (disconnected, closed): the listener comes and goes with it. */
export function setRenewTarget(next: RenewTarget | null): void {
  target = next;
  if (typeof document === 'undefined') return;
  if (next && !listening) {
    document.addEventListener('click', onDocumentClick);
    listening = true;
  } else if (!next && listening) {
    document.removeEventListener('click', onDocumentClick);
    listening = false;
  }
}

export function renewTargetDb(): SieveDb | null {
  return target?.db ?? null;
}

/** Tests: no target, no listener, no throttle. */
export function resetGmailRenew(): void {
  setRenewTarget(null);
  lastAttempt = Number.NEGATIVE_INFINITY;
}
