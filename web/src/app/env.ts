// Typed access to the VITE_ variables (40 section 3.2). App Check keys are read by the AI layer, not here.
// Every variable is read by name (import.meta.env.VITE_X), never through the whole import.meta.env object: Vite
// then inlines only the values this file uses, so the names of the e2e seams (VITE_SIEVE_E2E, VITE_E2E) never
// reach a production bundle (60 section 3.9.1; check:repo looks for them).

export interface Env {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    messagingSenderId: string;
    databaseURL: string;
  };
  fcmVapidKey: string;
  functionsRegion: string;
  extensionId?: string;
  extensionStoreUrl?: string;
  repoUrl: string;
  googleOAuthClientId?: string;   // VITE_GOOGLE_OAUTH_CLIENT_ID (20 section 15.1)
  useEmulators: boolean;
  e2e: boolean;
}

/** The raw values, one field per variable; undefined or blank means unset. */
export interface EnvSource {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
  messagingSenderId?: string;
  databaseURL?: string;
  fcmVapidKey?: string;
  functionsRegion?: string;
  extensionId?: string;
  extensionStoreUrl?: string;
  repoUrl?: string;
  googleOAuthClientId?: string;
  useEmulators?: string;
  e2e?: string;                    // VITE_E2E
  sieveE2e?: string;               // VITE_SIEVE_E2E (60 section 3.9.1)
}

/** The variable behind each field that can be reported missing. */
export const ENV_NAMES = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  databaseURL: 'VITE_FIREBASE_DATABASE_URL',
  fcmVapidKey: 'VITE_FCM_VAPID_KEY',
  repoUrl: 'VITE_REPO_URL',
} as const;

/** Needed before the first paint: the Firebase app and Auth cannot start without them. */
export const REQUIRED_AT_BOOT = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;

/** Required by the feature that uses them (Realtime Database, push, footer), checked with requireEnv() on first use. */
export const REQUIRED_ON_USE = {
  messagingSenderId: ENV_NAMES.messagingSenderId,
  databaseURL: ENV_NAMES.databaseURL,
  fcmVapidKey: ENV_NAMES.fcmVapidKey,
  repoUrl: ENV_NAMES.repoUrl,
} as const;

export class MissingEnvError extends Error {
  constructor(readonly names: string[]) {
    super(missingEnvMessage(names));
    this.name = 'MissingEnvError';
  }
}

export function missingEnvMessage(names: string[]): string {
  return `Missing ${names.join(', ')}. Copy web/.env.example to web/.env.local.`;
}

function str(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function flag(...values: (string | undefined)[]): boolean {
  return values.some((value) => {
    const v = str(value).toLowerCase();
    return v === 'true' || v === '1';
  });
}

/** Reads and checks the values. Throws MissingEnvError naming every missing boot variable. */
export function readEnv(source: EnvSource): Env {
  const missing = REQUIRED_AT_BOOT.filter((key) => str(source[key]) === '').map((key) => ENV_NAMES[key]);
  if (missing.length > 0) throw new MissingEnvError(missing);
  return {
    firebase: {
      apiKey: str(source.apiKey),
      authDomain: str(source.authDomain),
      projectId: str(source.projectId),
      appId: str(source.appId),
      messagingSenderId: str(source.messagingSenderId),
      databaseURL: str(source.databaseURL),
    },
    fcmVapidKey: str(source.fcmVapidKey),
    functionsRegion: str(source.functionsRegion) || 'us-central1',
    extensionId: str(source.extensionId) || undefined,
    extensionStoreUrl: str(source.extensionStoreUrl) || undefined,
    repoUrl: str(source.repoUrl),
    googleOAuthClientId: str(source.googleOAuthClientId) || undefined,
    useEmulators: flag(source.useEmulators),
    e2e: flag(source.e2e, source.sieveE2e),
  };
}

/** Each variable by name: Vite replaces every access with its build-time value. */
export const env: Env = readEnv({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  fcmVapidKey: import.meta.env.VITE_FCM_VAPID_KEY,
  functionsRegion: import.meta.env.VITE_FUNCTIONS_REGION,
  extensionId: import.meta.env.VITE_EXTENSION_ID,
  extensionStoreUrl: import.meta.env.VITE_EXTENSION_STORE_URL,
  repoUrl: import.meta.env.VITE_REPO_URL,
  googleOAuthClientId: import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
  useEmulators: import.meta.env.VITE_USE_EMULATORS,
  e2e: import.meta.env.VITE_E2E,
  sieveE2e: import.meta.env.VITE_SIEVE_E2E,
});

/** Returns a variable that a feature needs, or throws the same readable error as at boot. */
export function requireEnv(key: keyof typeof REQUIRED_ON_USE): string {
  const value = key === 'messagingSenderId' || key === 'databaseURL' ? env.firebase[key] : env[key];
  if (!value) throw new MissingEnvError([REQUIRED_ON_USE[key]]);
  return value;
}
