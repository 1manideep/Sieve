// Gmail after a reload when the Google sign-in script cannot load (20 section 15.1): the token was in memory only, so
// the connected row asks to sign in again; Continue opens the Firebase popup inside the click, the token is held and
// the sync picks up where it was. The sync jobs are stubbed: this file is about the sign-in, not the backfill.
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
vi.mock('./gmail/sync', () => ({ runGmailSync, startGmailTimers, setGmailPaused: vi.fn(), stopGmailSync: vi.fn(async () => undefined) }));

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

describe('Gmail Continue after a reload, with the Google sign-in script blocked', () => {
  it('on start, the row asks to sign in again and drops the old load error', () => {
    expect(gmailStartPatch({ errorCode: 'gis-load-failed' }, false)).toEqual({ needsAuth: true, error: undefined, errorCode: undefined });
    expect(gmailStartPatch({ errorCode: 'popup-closed' }, true)).toEqual({ error: undefined, errorCode: undefined });
    expect(gmailStartPatch({ errorCode: 'quota' }, false)).toEqual({ needsAuth: true });
    expect(gmailStartPatch({}, true)).toEqual({});
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
    expect(JSON.stringify(row)).not.toContain(fakeAuth.FAKE_POPUP_ACCESS_TOKEN);
  });

  it('a closed popup keeps the row asking, with the plain closed line and never the load error', async () => {
    fakeAuth.reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }));
    await reauthorize(db, 'gmail');
    const row = await db.sources.get('gmail');
    expect(row).toMatchObject({ needsAuth: true, errorCode: 'popup-closed', error: SOURCE_COPY.popupClosed });
    expect(getGmailToken()).toBeNull();
    expect(runGmailSync).not.toHaveBeenCalled();
  });
});
