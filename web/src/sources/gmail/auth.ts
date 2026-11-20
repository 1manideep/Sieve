// Google Identity Services token client for gmail.readonly (20 section 15.1). The token lives only in this
// module's memory: never in IndexedDB, localStorage, sessionStorage, Firestore, a URL or a log.
import { env } from '@/app/env';
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

let token: { value: string; expiresAt: number } | null = null;
let gisPromise: Promise<void> | null = null;
let client: TokenClient | null = null;
let pending: { resolve: () => void; reject: (e: unknown) => void } | null = null;

function oauth2(): GoogleOauth2 | undefined {
  return (globalThis as unknown as { google?: GoogleGlobal }).google?.accounts?.oauth2;
}

/**
 * The OAuth client id, read from web/src/app/env.ts as `env.googleOAuthClientId` (VITE_GOOGLE_OAUTH_CLIENT_ID).
 * env.ts does not expose it yet (contract change request in the WP4 report); until it does this is undefined
 * and Gmail sign-in reports that it is not set up.
 */
export function gmailClientId(): string | undefined {
  const id = (env as typeof env & { googleOAuthClientId?: string }).googleOAuthClientId;
  return id && id.trim() ? id.trim() : undefined;
}

/** Inject the GIS script once; resolve when google.accounts.oauth2 exists. */
export function preloadGis(): Promise<void> {
  if (oauth2()) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const fail = () => {
      gisPromise = null;
      reject(new SourceError('gis-load-failed', SOURCE_COPY.gisLoadFailed));
    };
    const timer = setTimeout(fail, GIS_LOAD_TIMEOUT_MS);
    const done = () => {
      if (oauth2()) {
        clearTimeout(timer);
        resolve();
      }
    };
    if (typeof document === 'undefined') return fail();
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', done);
    script.addEventListener('error', () => {
      clearTimeout(timer);
      fail();
    });
    done();
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

/** Call synchronously inside the click handler so the popup keeps the user activation. */
export function requestGmailToken(opts: { prompt: '' | 'consent' | 'select_account'; loginHint?: string }): Promise<void> {
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
  const o = oauth2();
  if (!t || !o) return;
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
