// Google Identity Services token client for gmail.readonly (20 section 15.1). The token lives only in this
// module's memory: never in IndexedDB, localStorage, sessionStorage, Firestore, a URL or a log.
// When the Google sign-in script is not there at click time (blocked, still loading, or no client id), the same click
// asks through the Firebase popup instead (reauthenticateWithPopup with the gmail.readonly scope). It never waits for
// the script: the popup must open inside the click.
import { GoogleAuthProvider, reauthenticateWithPopup, type User, type UserCredential } from 'firebase/auth';
import { env } from '@/app/env';
import { getAuthInstance } from '@/app/firebase';
import { GIS_LOAD_TIMEOUT_MS, GIS_SRC, GMAIL_SCOPE, GMAIL_TOKEN_SKEW_MS } from '../../index/config';
import { SOURCE_COPY, SourceError } from '../types';

interface TokenResponse { access_token?: string; expires_in?: number | string; error?: string; error_description?: string; scope?: string }
interface TokenClient { requestAccessToken(o?: { prompt?: string; login_hint?: string }): void }
interface GoogleOauth2 {
  initTokenClient(config: {
    client_id: string; scope: string; include_granted_scopes?: boolean;
    callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}
interface GoogleGlobal { accounts?: { oauth2?: GoogleOauth2 } }

/** A token from the Firebase popup carries no lifetime; Google's access tokens last an hour. */
export const FIREBASE_TOKEN_MS = 55 * 60_000;
/** POST endpoints: the token goes in the body, never in a URL. */
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

let token: { value: string; expiresAt: number } | null = null;
let gisPromise: Promise<void> | null = null;
let client: TokenClient | null = null;
let pending: { resolve: () => void; reject: (e: unknown) => void } | null = null;

function oauth2(): GoogleOauth2 | undefined {
  return (globalThis as unknown as { google?: GoogleGlobal }).google?.accounts?.oauth2;
}

/**
 * The OAuth client id, read from web/src/app/env.ts as `env.googleOAuthClientId` (VITE_GOOGLE_OAUTH_CLIENT_ID).
 * Without it the Google sign-in script cannot be used, and the Firebase popup asks instead.
 */
export function gmailClientId(): string | undefined {
  const id = (env as typeof env & { googleOAuthClientId?: string }).googleOAuthClientId;
  return id && id.trim() ? id.trim() : undefined;
}

/**
 * Inject the GIS script once; resolve when google.accounts.oauth2 exists. Best effort, on mount: a click never waits
 * for it. A script that failed or timed out is removed, so the next attempt injects a fresh one (a dead element never
 * fires again, and reusing it would make every later attempt wait out the timeout).
 */
export function preloadGis(): Promise<void> {
  if (oauth2()) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      gisPromise = null;
      reject(new SourceError('gis-load-failed', SOURCE_COPY.gisLoadFailed));
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    const el = script;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
      if (ok) {
        resolve();
        return;
      }
      el.remove();
      gisPromise = null;
      reject(new SourceError('gis-load-failed', SOURCE_COPY.gisLoadFailed));
    };
    const onLoad = () => {
      if (oauth2()) finish(true);
    };
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(Boolean(oauth2())), GIS_LOAD_TIMEOUT_MS);
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    onLoad();
  });
  return gisPromise;
}

function tokenClient(): TokenClient {
  const o = oauth2();
  if (!o) throw new SourceError('gis-load-failed', SOURCE_COPY.gisLoadFailed);
  const clientId = gmailClientId();
  if (!clientId) throw new SourceError('unknown', SOURCE_COPY.noClientId);
  client ??= o.initTokenClient({
    client_id: clientId,
    scope: GMAIL_SCOPE,
    include_granted_scopes: false,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (resp.error || !resp.access_token) {
        p?.reject(new SourceError('scope-denied', SOURCE_COPY.scopeDenied));
        return;
      }
      if (!o.hasGrantedAllScopes(resp, GMAIL_SCOPE)) {
        try {
          o.revoke(resp.access_token);
        } catch {
          // nothing to undo
        }
        p?.reject(new SourceError('scope-denied', SOURCE_COPY.scopeDenied));
        return;
      }
      token = { value: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in ?? 3599) * 1000 };
      p?.resolve();
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      if (err?.type === 'popup_failed_to_open') p?.reject(new SourceError('popup-blocked', SOURCE_COPY.popupBlocked));
      else if (err?.type === 'popup_closed') p?.reject(new SourceError('popup-closed', SOURCE_COPY.popupClosed));
      else p?.reject(new SourceError('unknown', SOURCE_COPY.signInFailed));
    },
  });
  return client;
}

type TokenRequest = { prompt: '' | 'consent' | 'select_account'; loginHint?: string };

/**
 * Call synchronously inside the click handler so the popup keeps the user activation. Google Identity Services when
 * it has loaded; otherwise the Firebase popup, at once.
 */
export function requestGmailToken(opts: TokenRequest): Promise<void> {
  return oauth2() && gmailClientId() ? requestWithGis(opts) : requestWithFirebase(opts);
}

function requestWithGis(opts: TokenRequest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      const c = tokenClient();
      pending?.reject(new SourceError('popup-closed', SOURCE_COPY.popupClosed));
      pending = { resolve, reject };
      const req: { prompt: string; login_hint?: string } = { prompt: opts.prompt };
      if (opts.loginHint) req.login_hint = opts.loginHint;
      c.requestAccessToken(req);
    } catch (e) {
      pending = null;
      reject(e);
    }
  });
}

/** Firebase popup errors as source errors. Only the code is read: the error can carry the credential. */
function popupError(e: unknown): SourceError {
  if (e instanceof SourceError) return e;
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'auth/popup-blocked') return new SourceError('popup-blocked', SOURCE_COPY.popupBlocked);
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') {
    return new SourceError('popup-closed', SOURCE_COPY.popupClosed);
  }
  if (code === 'auth/user-mismatch') return new SourceError('unknown', SOURCE_COPY.otherAccount);
  return new SourceError('unknown', SOURCE_COPY.signInFailed);
}

/** The scopes Google granted this token, or null when the check could not run (the Gmail calls that follow will say). */
async function grantedScopes(accessToken: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(TOKENINFO_URL, { method: 'POST', body: new URLSearchParams({ access_token: accessToken }) });
  } catch {
    return null;
  }
  if (!res.ok) throw new SourceError('unknown', SOURCE_COPY.signInFailed);
  const info = (await res.json().catch(() => null)) as { scope?: unknown } | null;
  return typeof info?.scope === 'string' ? info.scope : '';
}

async function keepFirebaseToken(result: UserCredential): Promise<void> {
  const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!accessToken) throw new SourceError('unknown', SOURCE_COPY.signInFailed);
  // The credential is trusted when the result lists its scopes; Firebase usually does not, so Google is asked.
  const listed = (result as UserCredential & { _tokenResponse?: { scope?: unknown } })._tokenResponse?.scope;
  const scopes = typeof listed === 'string' ? listed : await grantedScopes(accessToken);
  if (scopes !== null && !scopes.split(/[\s,]+/).includes(GMAIL_SCOPE)) throw new SourceError('scope-denied', SOURCE_COPY.scopeDenied);
  token = { value: accessToken, expiresAt: Date.now() + FIREBASE_TOKEN_MS };
}

/** The Firebase popup for the signed-in Google account, opened before any await. */
function requestWithFirebase(opts: TokenRequest): Promise<void> {
  let user: User | null;
  try {
    user = getAuthInstance().currentUser;
  } catch {
    user = null;
  }
  // Neither way is open: no Google sign-in script and no Google account to ask through.
  if (!user || user.isAnonymous) return Promise.reject(new SourceError('gis-load-failed', SOURCE_COPY.gisLoadFailed));
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_SCOPE);
  provider.setCustomParameters({ ...(opts.prompt ? { prompt: 'consent' } : {}), ...(user.email ? { login_hint: user.email } : {}) });
  let popup: Promise<UserCredential>;
  try {
    popup = reauthenticateWithPopup(user, provider);
  } catch (e) {
    return Promise.reject(popupError(e));
  }
  return popup.then(keepFirebaseToken).catch((e: unknown) => {
    throw popupError(e);
  });
}

/** The token, or null from GMAIL_TOKEN_SKEW_MS before it expires. */
export function getGmailToken(): string | null {
  if (!token) return null;
  if (Date.now() >= token.expiresAt - GMAIL_TOKEN_SKEW_MS) return null;
  return token.value;
}

export function clearGmailToken(): void {
  token = null;
}

export async function revokeGmailToken(): Promise<void> {
  const t = token?.value;
  token = null;
  if (!t) return;
  const o = oauth2();
  if (!o) {
    // No Google sign-in script (the token came from the Firebase popup): Google's revoke endpoint, token in the body.
    try {
      await fetch(REVOKE_URL, { method: 'POST', body: new URLSearchParams({ token: t }) });
    } catch {
      // Offline: the token still runs out within the hour, and Sieve has already forgotten it.
    }
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      o.revoke(t, () => resolve());
    } catch {
      resolve();
    }
  });
}

/** Replaces token-shaped strings before anything is logged (20 section 15.1). */
export function scrubToken(s: string): string {
  return s.replace(/ya29\.[\w.-]+/g, '[token]');
}

/** Tests: forget the token client so a new fake GIS can be installed. */
export function resetGmailAuth(): void {
  token = null;
  client = null;
  pending = null;
  gisPromise = null;
}
