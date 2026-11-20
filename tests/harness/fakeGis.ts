// A stand-in for Google Identity Services' token client (20 section 15.1), so tests run the real auth module.

export interface FakeGisOptions {
  token?: string;
  expiresIn?: number;
  grantAll?: boolean;
  respondWith?: 'token' | 'error' | 'popup_failed_to_open' | 'popup_closed';
}

export function installFakeGis(opts: FakeGisOptions = {}): { requests: { prompt?: string; login_hint?: string }[]; revoked: string[]; set(o: FakeGisOptions): void; uninstall(): void } {
  let current: FakeGisOptions = { token: 'ya29.fake-token-0123456789', expiresIn: 3599, grantAll: true, respondWith: 'token', ...opts };
  const requests: { prompt?: string; login_hint?: string }[] = [];
  const revoked: string[] = [];
  const g = globalThis as unknown as { google?: unknown };
  const prev = g.google;
  g.google = {
    accounts: {
      oauth2: {
        initTokenClient(cfg: { callback: (r: Record<string, unknown>) => void; error_callback?: (e: { type: string }) => void }) {
          return {
            requestAccessToken(o?: { prompt?: string; login_hint?: string }) {
              requests.push(o ?? {});
              queueMicrotask(() => {
                if (current.respondWith === 'popup_failed_to_open' || current.respondWith === 'popup_closed') cfg.error_callback?.({ type: current.respondWith });
                else if (current.respondWith === 'error') cfg.callback({ error: 'access_denied' });
                else cfg.callback({ access_token: current.token, expires_in: current.expiresIn, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
              });
            },
          };
        },
        hasGrantedAllScopes: () => current.grantAll !== false,
        revoke: (t: string, done?: () => void) => {
          revoked.push(t);
          done?.();
        },
      },
    },
  };
  return {
    requests,
    revoked,
    set(o) {
      current = { ...current, ...o };
    },
    uninstall() {
      g.google = prev;
    },
  };
}
