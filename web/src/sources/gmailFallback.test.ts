// Gmail Continue when the Google sign-in script cannot load (20 section 15.1): the row asks to sign in again (the
// token on this computer ran out); Continue opens the Firebase popup inside the click, the token is kept on the row
// and the sync picks up where it was. The sync jobs are stubbed: this file is about the sign-in, not the backfill.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropDb, freshDb } from '../../../tests/harness/indexEnv';
import { GMAIL_SCOPE } from '../index/config';
import type { SieveDb } from '../index/db';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));
vi.mock('@/app/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/env')>();
  return { ...m, env: { ...m.env, googleOAuthClientId: 'test-client.apps.googleusercontent.com' } };
});
const runGmailSync = vi.fn(async () => undefined);
const startGmailTimers = vi.fn();
vi.mock('./gmail/sync', () => ({ runGmailSync, startGmailTimers, setGmailPaused: vi.fn(), stopGmailSync: vi.fn(async () => undefined), syncAfterNewToken: vi.fn() }));

const fakeAuth = await import('@/test/fakes/firebaseAuth');
const { gmailStartPatch, reauthorize } = await import('./registry');
const { getGmailToken, resetGmailAuth } = await import('./gmail/auth');
const { SOURCE_COPY } = await import('./types');

const realFetch = globalThis.fetch;
let db: SieveDb;

beforeEach(async () => {
  resetGmailAuth();
  fakeAuth.setFakeAuthUser(fakeAuth.googleUser);
  globalThis.fetch = (async () => new Response(JSON.stringify({ scope: `openid ${GMAIL_SCOPE}` }), { status: 200 })) as typeof fetch;
  db = freshDb('real');
  // Connected and part way through, as the sync left it before the reload.
  await db.sources.put({
    kind: 'gmail', connected: true, account: 'mani@example.com', cursor: '4242', phase: 'idle',
    progress: { done: 300, total: 1200 }, paused: false, needsAuth: true,
    errorCode: 'gis-load-failed', error: "Couldn't load Google sign-in. If an ad blocker is on for this site, allow accounts.google.com and try again.",
  });
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  fakeAuth.setFakeAuthUser(null);
  resetGmailAuth();
  await dropDb(db);
});

describe('Gmail Continue with the Google sign-in script blocked', () => {
  it('on start, the row never asks merely because this tab holds no token; it drops the old load error', () => {
    const now = Date.now();
    const kept = { value: 'ya29.kept', expiresAt: now + 30 * 60_000, scope: GMAIL_SCOPE };
    const spent = { ...kept, expiresAt: now - 1 };
    expect(gmailStartPatch({ errorCode: 'gis-load-failed' }, now)).toEqual({ error: undefined, errorCode: undefined });
    expect(gmailStartPatch({ errorCode: 'quota' }, now)).toEqual({});
    expect(gmailStartPatch({ needsAuth: true, accessToken: spent }, now)).toEqual({});   // the first sync asks
    // A usable token on this computer clears an old ask.
    expect(gmailStartPatch({ needsAuth: true, accessToken: kept }, now)).toEqual({ needsAuth: false });
    expect(gmailStartPatch({ errorCode: 'popup-closed', accessToken: kept }, now)).toEqual({ error: undefined, errorCode: undefined });
    expect(gmailStartPatch({ accessToken: kept }, now)).toEqual({});
  });

  it('Continue opens the Firebase popup inside the click, holds the token and clears needsAuth', async () => {
    expect(getGmailToken()).toBeNull();
    expect((globalThis as { google?: unknown }).google).toBeUndefined();

    const click = reauthorize(db, 'gmail');
    // Before anything is awaited: the popup keeps the click.
    expect(fakeAuth.reauthenticateWithPopup).toHaveBeenCalledOnce();
    await click;

    expect(getGmailToken()).toBe(fakeAuth.FAKE_POPUP_ACCESS_TOKEN);
    const row = await db.sources.get('gmail');
    expect(row).toMatchObject({ connected: true, needsAuth: false, cursor: '4242', progress: { done: 300, total: 1200 } });
    expect(row?.error).toBeUndefined();
    expect(row?.errorCode).toBeUndefined();
    // The sync picks up where it was (auto mode), not a backfill from scratch.
    expect(runGmailSync).toHaveBeenCalledWith(db);
    expect(startGmailTimers).toHaveBeenCalledWith(db);
    // Kept on the row for every tab of this account, with its end and scopes (about 55 minutes for a popup token).
    const kept = (row as { accessToken?: { value: string; expiresAt: number; scope: string } } | undefined)?.accessToken;
    expect(kept?.value).toBe(fakeAuth.FAKE_POPUP_ACCESS_TOKEN);
    expect(kept?.scope).toContain(GMAIL_SCOPE);
    expect(kept!.expiresAt - Date.now()).toBeGreaterThan(50 * 60_000);
  });

  it('a fresh token that Gmail still refuses gives the warning, with Continue again, and is not kept', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).startsWith('https://gmail.googleapis.com/')
        ? new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }), { status: 401 })
        : new Response(JSON.stringify({ scope: `openid ${GMAIL_SCOPE}` }), { status: 200 })) as typeof fetch;
    await reauthorize(db, 'gmail');
    await vi.waitFor(async () => expect((await db.sources.get('gmail')) as { accessToken?: unknown }).not.toHaveProperty('accessToken'));
    const row = await db.sources.get('gmail');
    expect(row).toMatchObject({ needsAuth: true, errorCode: 'auth-needed', error: SOURCE_COPY.gmailAccessRefused });
    expect(getGmailToken()).toBeNull();
    expect(runGmailSync).not.toHaveBeenCalled();
  });

  it('a closed popup keeps the row asking, with the plain closed line and never the load error', async () => {
    fakeAuth.reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }));
    await reauthorize(db, 'gmail');
    const row = await db.sources.get('gmail');
    expect(row).toMatchObject({ needsAuth: true, errorCode: 'popup-closed', error: SOURCE_COPY.popupClosed });
    expect(row).not.toHaveProperty('accessToken');
    expect(getGmailToken()).toBeNull();
    expect(runGmailSync).not.toHaveBeenCalled();
  });
});
