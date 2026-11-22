// The renewal with no click, from the Gmail sync timer (renew.ts): asked only when access is about to end or has
// ended by time; a window Chrome blocks stops the timer and leaves clicks working; another failure stops both.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SieveDb } from '../../index/db';
import { SourceError } from '../types';

const auth = vi.hoisted(() => ({
  gisAvailable: vi.fn(() => true),
  gmailTokenExpiresAt: vi.fn((): number | null => null),
  gmailTokenRequestOpen: vi.fn(() => false),
  requestGmailToken: vi.fn((_opts: { prompt: string; loginHint?: string }): Promise<void> => Promise.resolve()),
}));
vi.mock('./auth', () => auth);

const { GMAIL_RENEW_BEFORE_MS, GMAIL_RENEW_EVERY_MS, renewInClick, renewOnTimer, resetGmailRenew, setRenewTarget } = await import('./renew');

const db = {} as SieveDb;
const NOW = 1_800_000_000_000;

function target(expiresAt: number | null, blocked = false) {
  const t = { db, account: 'person@inbox.example', expiresAt, blocked, onToken: vi.fn(async () => undefined) };
  setRenewTarget(t);
  return t;
}

beforeEach(() => {
  resetGmailRenew();
  auth.gisAvailable.mockReturnValue(true);
  auth.gmailTokenExpiresAt.mockReturnValue(null);
  auth.gmailTokenRequestOpen.mockReturnValue(false);
  auth.requestGmailToken.mockReset().mockResolvedValue(undefined);
});

describe('renewOnTimer', () => {
  it('asks Google when access is about to end or has ended by time, and keeps the token', async () => {
    const soon = target(NOW + GMAIL_RENEW_BEFORE_MS - 1);
    await renewOnTimer(NOW);
    expect(auth.requestGmailToken).toHaveBeenCalledWith({ prompt: '', loginHint: 'person@inbox.example' });
    expect(soon.onToken).toHaveBeenCalledWith(db);
    // ended an hour ago: still asked
    resetGmailRenew();
    const ended = target(NOW - 3_600_000);
    await renewOnTimer(NOW);
    expect(ended.onToken).toHaveBeenCalledTimes(1);
  });

  it('asks nothing while access has time left, without a target, when paused or refused, or right after another try', async () => {
    target(NOW + GMAIL_RENEW_BEFORE_MS + 60_000);
    expect(renewOnTimer(NOW)).toBeNull();
    setRenewTarget(null);
    expect(renewOnTimer(NOW)).toBeNull();
    target(NOW, true);
    expect(renewOnTimer(NOW)).toBeNull();
    target(null);
    expect(renewOnTimer(NOW)).toBeNull();
    auth.gisAvailable.mockReturnValue(false);
    target(NOW);
    expect(renewOnTimer(NOW)).toBeNull();
    auth.gisAvailable.mockReturnValue(true);
    await renewOnTimer(NOW);
    expect(renewOnTimer(NOW + GMAIL_RENEW_EVERY_MS - 1)).toBeNull();
    expect(auth.requestGmailToken).toHaveBeenCalledTimes(1);
  });

  it('a window Chrome blocked stops the timer on this page; a click still renews', async () => {
    const t = target(NOW);
    auth.requestGmailToken.mockRejectedValueOnce(new SourceError('popup-blocked', 'blocked'));
    await expect(renewOnTimer(NOW)).rejects.toBeInstanceOf(SourceError);
    expect(t.blocked).toBe(false);
    expect(renewOnTimer(NOW + GMAIL_RENEW_EVERY_MS)).toBeNull();
    await renewInClick(NOW + GMAIL_RENEW_EVERY_MS);
    expect(t.onToken).toHaveBeenCalledTimes(1);
  });

  it('any other failure stops renewals until Continue, as a failed click does', async () => {
    const t = target(NOW);
    auth.requestGmailToken.mockRejectedValueOnce(new SourceError('popup-closed', 'closed'));
    await expect(renewOnTimer(NOW)).rejects.toBeInstanceOf(SourceError);
    expect(t.blocked).toBe(true);
    expect(renewInClick(NOW + GMAIL_RENEW_EVERY_MS)).toBeNull();
  });
});
