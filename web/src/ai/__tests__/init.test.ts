import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initializeAppCheck = vi.fn((_app: unknown, _opts: unknown) => ({ kind: 'app-check' }));
const getAI = vi.fn((_app: unknown, _opts: unknown) => ({ kind: 'ai' }));
vi.mock('firebase/app-check', () => ({
  initializeAppCheck,
  ReCaptchaEnterpriseProvider: class {
    constructor(readonly siteKey: string) {}
  },
}));
vi.mock('firebase/ai', async (orig) => ({ ...(await orig<typeof import('firebase/ai')>()), getAI }));

const app = { name: 'test' } as never;

describe('initAi (10 section 5)', () => {
  beforeEach(async () => {
    vi.resetModules();
    initializeAppCheck.mockClear();
    getAI.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown }).FIREBASE_APPCHECK_DEBUG_TOKEN;
  });

  it('needs the reCAPTCHA Enterprise site key', async () => {
    vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', '');
    const { initAi } = await import('../init');
    expect(() => initAi(app)).toThrow('Missing VITE_RECAPTCHA_ENTERPRISE_SITE_KEY. Copy web/.env.example to web/.env.local.');
  });

  it('starts App Check, then the AI instance, once; the debug token is set before App Check', async () => {
    vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'site-key');
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'true');
    const { initAi, getAiInstance, getAppCheckInstance } = await import('../init');
    expect(() => getAiInstance()).toThrow('initAi(app) was not called');
    initAi(app);
    initAi(app);
    expect(initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(initializeAppCheck.mock.calls[0][1]).toMatchObject({ isTokenAutoRefreshEnabled: true });
    expect(getAI).toHaveBeenCalledTimes(1);
    expect(getAI.mock.calls[0][1]).toMatchObject({ useLimitedUseAppCheckTokens: false });
    expect((self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown }).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
    expect(getAiInstance()).toEqual({ kind: 'ai' });
    expect(getAppCheckInstance()).toEqual({ kind: 'app-check' });
  });

  it('refuses a debug token in a production build', async () => {
    vi.stubEnv('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', 'site-key');
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'abc');
    vi.stubEnv('PROD', true);
    const { initAi } = await import('../init');
    expect(() => initAi(app)).toThrow('VITE_APPCHECK_DEBUG_TOKEN must not be set for a production build');
    expect(initializeAppCheck).not.toHaveBeenCalled();
  });

  it('the e2e seam starts neither App Check nor the backend', async () => {
    vi.stubEnv('VITE_SIEVE_E2E', '1');
    const { initAi } = await import('../init');
    initAi(app);
    expect(initializeAppCheck).not.toHaveBeenCalled();
    expect(getAI).not.toHaveBeenCalled();
  });
});
