// Gmail sign-in (20 section 15.1): the Google sign-in script loader recovers from a failed load, and when the script
// is not there at click time the same click asks through the Firebase popup at once. The token stays in memory only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeGis } from '../../../../tests/harness/fakeGis';
import { GIS_LOAD_TIMEOUT_MS, GIS_SRC, GMAIL_SCOPE, GMAIL_TOKEN_SKEW_MS } from '../../index/config';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));
vi.mock('@/app/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/env')>();
  return { ...m, env: { ...m.env, googleOAuthClientId: 'test-client.apps.googleusercontent.com' } };
});

const fakeAuth = await import('@/test/fakes/firebaseAuth');
const { FIREBASE_TOKEN_MS, getGmailToken, preloadGis, requestGmailToken, resetGmailAuth, revokeGmailToken } = await import('./auth');
const { SOURCE_COPY } = await import('../types');

const TOKEN = fakeAuth.FAKE_POPUP_ACCESS_TOKEN;
const realFetch = globalThis.fetch;

function gisScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
}

/** Google's token info endpoint, answering with these scopes. */
function tokenInfo(scope: string) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ scope }), { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function lastProvider(): InstanceType<typeof fakeAuth.GoogleAuthProvider> {
  return fakeAuth.reauthenticateWithPopup.mock.calls.at(-1)?.[1] as InstanceType<typeof fakeAuth.GoogleAuthProvider>;
}

beforeEach(() => {
  resetGmailAuth();
  gisScript()?.remove();
  fakeAuth.setFakeAuthUser(fakeAuth.googleUser);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  resetGmailAuth();
  gisScript()?.remove();
  fakeAuth.setFakeAuthUser(null);
});

describe('preloadGis', () => {
  it('removes a script that failed, so the next attempt injects a fresh one and loads', async () => {
    const first = preloadGis();
    const dead = gisScript();
    expect(dead).not.toBeNull();
    dead?.dispatchEvent(new Event('error'));
    await expect(first).rejects.toMatchObject({ code: 'gis-load-failed' });
    expect(gisScript()).toBeNull();

    const second = preloadGis();
    const fresh = gisScript();
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(dead);
    const gis = installFakeGis();
    fresh?.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBeUndefined();
    gis.uninstall();
  });

  it('removes a script that timed out, so the next attempt does not wait on it', async () => {
    vi.useFakeTimers();
    const first = preloadGis();
    const stalled = gisScript();
    const failed = expect(first).rejects.toMatchObject({ code: 'gis-load-failed' });
    await vi.advanceTimersByTimeAsync(GIS_LOAD_TIMEOUT_MS);
    await failed;
    expect(stalled?.isConnected).toBe(false);
    void preloadGis().catch(() => undefined);
    expect(gisScript()).not.toBe(stalled);
    expect(document.querySelectorAll(`script[src="${GIS_SRC}"]`)).toHaveLength(1);
  });
});

describe('requestGmailToken without the Google sign-in script', () => {
  it('GIS missing at click time: the Firebase popup is used at once and a token is held', async () => {
    const fetchMock = tokenInfo(`openid email ${GMAIL_SCOPE}`);
    const asked = requestGmailToken({ prompt: 'select_account' });
    // Synchronously, inside the click: nothing waited for the script.
    expect(fakeAuth.reauthenticateWithPopup).toHaveBeenCalledOnce();
    expect(fakeAuth.reauthenticateWithPopup.mock.calls[0]?.[0]).toMatchObject({ uid: fakeAuth.googleUser.uid });
    expect(lastProvider().scopes).toEqual([GMAIL_SCOPE]);
    expect(lastProvider().customParameters).toEqual({ prompt: 'consent', login_hint: 'mani@example.com' });
    expect(gisScript()).toBeNull();
    await expect(asked).resolves.toBeUndefined();
    expect(getGmailToken()).toBe(TOKEN);

    // The scope check sends the token in the body of a POST, never in a URL.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://oauth2.googleapis.com/tokeninfo');
    expect(String(url)).not.toContain(TOKEN);
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain(TOKEN);

    // Memory only.
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i) ?? '')).not.toContain(TOKEN);
    for (let i = 0; i < sessionStorage.length; i++) expect(sessionStorage.getItem(sessionStorage.key(i) ?? '')).not.toContain(TOKEN);
  });

  it('holds the token for about 55 minutes, then asks again through the same popup (Continue)', async () => {
    tokenInfo(GMAIL_SCOPE);
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    await requestGmailToken({ prompt: 'select_account' });
    now.mockReturnValue(start + FIREBASE_TOKEN_MS - GMAIL_TOKEN_SKEW_MS - 1);
    expect(getGmailToken()).toBe(TOKEN);
    now.mockReturnValue(start + FIREBASE_TOKEN_MS - GMAIL_TOKEN_SKEW_MS);
    expect(getGmailToken()).toBeNull();

    // reauthorize: the popup opens at once, for the same account, without the consent screen.
    const renewed = requestGmailToken({ prompt: '', loginHint: 'mani@example.com' });
    expect(fakeAuth.reauthenticateWithPopup).toHaveBeenCalledTimes(2);
    expect(lastProvider().customParameters).toEqual({ login_hint: 'mani@example.com' });
    await renewed;
    expect(getGmailToken()).toBe(TOKEN);
  });

  it('trusts a result that lists its scopes, with no token info call', async () => {
    const fetchMock = tokenInfo('');
    fakeAuth.reauthenticateWithPopup.mockImplementationOnce(async (user) => ({
      user,
      credential: { accessToken: TOKEN },
      _tokenResponse: { scope: `openid ${GMAIL_SCOPE}` },
    }));
    await requestGmailToken({ prompt: 'select_account' });
    expect(getGmailToken()).toBe(TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a token without gmail.readonly connects nothing', async () => {
    tokenInfo('openid email profile');
    await expect(requestGmailToken({ prompt: 'select_account' })).rejects.toMatchObject({ code: 'scope-denied', message: SOURCE_COPY.scopeDenied });
    expect(getGmailToken()).toBeNull();
  });

  it('a blocked or closed popup says so, and never the Google sign-in line', async () => {
    fakeAuth.reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }));
    await expect(requestGmailToken({ prompt: 'select_account' })).rejects.toMatchObject({ code: 'popup-blocked', message: SOURCE_COPY.popupBlocked });
    fakeAuth.reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }));
    await expect(requestGmailToken({ prompt: 'select_account' })).rejects.toMatchObject({ code: 'popup-closed', message: SOURCE_COPY.popupClosed });
    fakeAuth.reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('other'), { code: 'auth/user-mismatch' }));
    await expect(requestGmailToken({ prompt: 'select_account' })).rejects.toMatchObject({ code: 'unknown', message: SOURCE_COPY.otherAccount });
    expect(getGmailToken()).toBeNull();
  });

  it('says Google sign-in could not load only when neither way is open', async () => {
    fakeAuth.setFakeAuthUser(null);
    await expect(requestGmailToken({ prompt: 'select_account' })).rejects.toMatchObject({
      code: 'gis-load-failed',
      message: "Sign in to Sieve with Google first, then connect Gmail.",
    });
    expect(fakeAuth.reauthenticateWithPopup).not.toHaveBeenCalled();
  });

  it('disconnect revokes a popup token through Google, in the body', async () => {
    tokenInfo(GMAIL_SCOPE);
    await requestGmailToken({ prompt: 'select_account' });
    const fetchMock = tokenInfo('');
    await revokeGmailToken();
    expect(getGmailToken()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://oauth2.googleapis.com/revoke');
    expect(String(init?.body)).toContain(TOKEN);
  });
});

describe('requestGmailToken with the Google sign-in script', () => {
  it('keeps Google Identity Services as the first choice', async () => {
    const gis = installFakeGis({ token: 'ya29.gis-token' });
    await requestGmailToken({ prompt: 'select_account' });
    expect(gis.requests).toEqual([{ prompt: 'select_account' }]);
    expect(fakeAuth.reauthenticateWithPopup).not.toHaveBeenCalled();
    expect(getGmailToken()).toBe('ya29.gis-token');
    gis.uninstall();
  });
});
