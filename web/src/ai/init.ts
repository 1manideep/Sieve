// initAi(app): App Check and the AI instance (10 section 5). Called by 40's initFirebase() before any model call.
import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { appCheckEnv } from './config';
import { isE2E } from './e2e';
import { installNanoWatchers } from './device/watchers';

let ai: AI | undefined;
let appCheck: AppCheck | undefined;
let initialised = false;

export const DEBUG_TOKEN_IN_PRODUCTION = 'VITE_APPCHECK_DEBUG_TOKEN must not be set for a production build';

/** Idempotent. Throws when the reCAPTCHA Enterprise site key is missing, or a debug token is set in production. */
export function initAi(app: FirebaseApp): void {
  if (initialised) return;
  if (isE2E()) {
    // 60 section 3.9.1: the e2e seam starts neither App Check nor the real AI backend.
    initialised = true;
    installNanoWatchers();
    return;
  }
  const { siteKey, debugToken, production } = appCheckEnv();
  if (!siteKey) throw new Error('Missing VITE_RECAPTCHA_ENTERPRISE_SITE_KEY. Copy web/.env.example to web/.env.local.');
  if (debugToken && production) throw new Error(DEBUG_TOKEN_IN_PRODUCTION);
  if (debugToken) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === 'true' ? true : debugToken;
  }
  appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
  // Replay protection stays off for the hackathon (limited-use tokens add an attestation per request).
  ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: false });
  initialised = true;
  installNanoWatchers();
}

export function getAiInstance(): AI {
  if (!ai) throw new Error('initAi(app) was not called');
  return ai;
}

export function getAppCheckInstance(): AppCheck {
  if (!appCheck) throw new Error('initAi(app) was not called');
  return appCheck;
}

/** Unit tests use an AI instance without App Check (10 section 15). null forgets it. */
export function setAiInstanceForTests(instance: AI | null): void {
  ai = instance ?? undefined;
}

export function resetInitForTests(): void {
  ai = undefined;
  appCheck = undefined;
  initialised = false;
}
