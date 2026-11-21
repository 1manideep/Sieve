// Build modes and the manifest transform (50 sections 4.2 and 12.3), shared by vite.config.ts, build.mjs and the tests.

export const HOSTED_ORIGIN = 'https://sieve.manideep.info';
export const DEV_ORIGIN = 'http://localhost:5173';
export const WEB_APP_ORIGIN = 'https://sieve-manideep.web.app';   // Hosting's default domain, until the custom domain is live
export const FIREBASE_APP_ORIGIN = 'https://sieve-manideep.firebaseapp.com';   // Hosting's second default domain, same site

/** The hosted app: every domain Firebase Hosting serves it on. Release and store trust these only. */
export const HOSTED_ORIGINS = [HOSTED_ORIGIN, WEB_APP_ORIGIN, FIREBASE_APP_ORIGIN];

/** @typedef {'dev' | 'release' | 'store'} BuildMode */

/** @type {Readonly<Record<BuildMode, { appUrl: string; origins: readonly string[]; out: string; keepKey: boolean }>>} */
export const MODES = {
  dev: { appUrl: DEV_ORIGIN, origins: [...HOSTED_ORIGINS, DEV_ORIGIN], out: 'dist-dev', keepKey: true },
  release: { appUrl: HOSTED_ORIGIN, origins: [...HOSTED_ORIGINS], out: 'dist', keepKey: true },
  store: { appUrl: HOSTED_ORIGIN, origins: [...HOSTED_ORIGINS], out: 'dist-store', keepKey: false },
};

/** Every key a built manifest may have (50 section 12.4, plus "commands" from section 8.9). */
export const ALLOWED_MANIFEST_KEYS = [
  'manifest_version', 'name', 'version', 'description', 'homepage_url', 'minimum_chrome_version', 'icons', 'action',
  'background', 'side_panel', 'permissions', 'commands', 'externally_connectable', 'content_security_policy', 'key',
];

export const ALLOWED_PERMISSIONS = ['sidePanel', 'notifications', 'storage'];

/**
 * @param {string} mode
 * @returns {mode is BuildMode}
 */
export function isBuildMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODES, mode);
}

/**
 * The externally_connectable match pattern for an origin: every path, this port only.
 * @param {string} origin
 */
export function matchFor(origin) {
  return `${origin}/*`;
}

/**
 * The origin a match pattern stands for ("https://sieve.manideep.info/*" -> "https://sieve.manideep.info").
 * @param {string} match
 */
export function originOfMatch(match) {
  const m = /^(https?:\/\/[^/*]+)\/\*$/.exec(match);
  if (!m) throw new Error(`unexpected match pattern ${match}`);
  return m[1];
}

/**
 * The manifest for one build mode: version from package.json, matches per mode, key kept or removed.
 * Pure: returns a new object and never mutates the source.
 * @param {Record<string, unknown>} source the parsed extension/manifest.json
 * @param {BuildMode} mode
 * @param {string} version extension/package.json "version"
 * @returns {Record<string, unknown>}
 */
export function transformManifest(source, mode, version) {
  const m = MODES[mode];
  if (!m) throw new Error(`unknown mode ${mode}`);
  if (typeof source.key !== 'string' || source.key.startsWith('REPLACE_WITH')) {
    throw new Error('manifest.json "key" still holds the placeholder (50 section 5.2)');
  }
  /** @type {Record<string, unknown>} */
  const out = structuredClone(source);
  out.version = version;
  out.externally_connectable = { matches: m.origins.map(matchFor) };
  if (!m.keepKey) delete out.key;
  return out;
}
