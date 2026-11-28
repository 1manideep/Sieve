/// <reference types="vite/client" />
interface ImportMetaEnv {
  // 40 section 3.2
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_DATABASE_URL: string;
  readonly VITE_FCM_VAPID_KEY: string;
  readonly VITE_FUNCTIONS_REGION?: string;        // default 'us-central1'
  readonly VITE_EXTENSION_ID?: string;            // absent: the extension bridge is off
  readonly VITE_EXTENSION_STORE_URL?: string;     // set: the store link leads, the site's zip (/downloads/) is "Or load it unpacked"
  readonly VITE_REPO_URL: string;
  readonly VITE_USE_EMULATORS?: 'true' | 'false' | '1' | '0' | '';
  readonly VITE_E2E?: 'true' | 'false' | '';
  // 10 section 4.2 (read only in web/src/ai/config.ts)
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  readonly VITE_CLOUD_MODEL_DRAFT?: string;
  readonly VITE_CLOUD_MODEL_FALLBACK?: string;
  // 20 section 15.1
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
  // 60 sections 3.9.1 and 4.7
  readonly VITE_SIEVE_E2E?: '1' | '0' | '';
  readonly VITE_RELAY_FROM_PLAYGROUND?: '1' | '0' | '';
}
interface ImportMeta { readonly env: ImportMetaEnv }
declare const __APP_VERSION__: string;            // Vite `define`, from web/package.json "version"
declare const __EXTENSION_VERSION__: string;      // Vite `define`, from extension/package.json "version" (the zip at /downloads/)
