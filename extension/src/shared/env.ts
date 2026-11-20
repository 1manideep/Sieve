// Build-time constants (50 section 4.3). vite.config.ts sets them per mode with `define`; vitest.config.ts sets the
// dev values for tests.
declare const __BUILD_MODE__: 'dev' | 'release' | 'store';
declare const __APP_URL__: string;
declare const __ALLOWED_ORIGINS__: readonly string[];

export const BUILD_MODE = __BUILD_MODE__;
export const APP_URL = __APP_URL__; // 'http://localhost:5173' in dev, else 'https://sieve.manideep.info'
export const ALLOWED_ORIGINS: readonly string[] = __ALLOWED_ORIGINS__; // the origins of this mode's manifest matches
export const REQUESTS_PATH = '/requests'; // Requests screen route (40 section 5.1)
