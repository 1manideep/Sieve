import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkManifest, findBanned } from '../scripts/lint-dist.mjs';
import { MODES, originOfMatch, transformManifest } from '../scripts/modes.mjs';
import { ALLOWED_ORIGINS } from '../src/shared/env';

const source = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as Record<string, unknown> & {
  permissions: string[];
  externally_connectable: { matches: string[]; ids?: string[] };
  content_security_policy: { extension_pages: string };
  description: string;
  icons: Record<string, string>;
  action: { default_icon: Record<string, string>; default_popup?: string };
  side_panel: { default_path: string };
  minimum_chrome_version: string;
  commands: Record<string, { suggested_key: Record<string, string>; description: string }>;
};
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const CSP =
  "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'; img-src 'self'; font-src 'self'; style-src 'self'";

describe('source manifest (50 section 4.1)', () => {
  it('is MV3 with exactly the three permissions and nothing wider', () => {
    expect(source.manifest_version).toBe(3);
    expect([...source.permissions].sort()).toEqual(['notifications', 'sidePanel', 'storage']);
    for (const key of ['host_permissions', 'content_scripts', 'web_accessible_resources', 'optional_permissions', 'optional_host_permissions']) {
      expect(source).not.toHaveProperty(key);
    }
    expect(checkManifest(source)).toEqual([]);
  });

  it('opens the panel page as the toolbar popup and keeps the side panel as a second surface', () => {
    expect(source.action.default_popup).toBe('sidepanel/index.html');
    expect(source.side_panel).toEqual({ default_path: 'sidepanel/index.html' });
    expect(existsSync(new URL('../src/sidepanel/index.html', import.meta.url))).toBe(true);
  });

  it('lets only the Sieve origins connect, and no other extension', () => {
    expect(source.externally_connectable.matches).toEqual(['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*', 'http://localhost:5173/*']);
    expect(source.externally_connectable.ids).toBeUndefined();
  });

  it('has the CSP exactly as specified', () => {
    expect(source.content_security_policy).toEqual({ extension_pages: CSP });
  });

  it('keeps the description within the Web Store summary limit', () => {
    expect(source.description.length).toBeLessThanOrEqual(132);
    expect(source.description).not.toMatch(/\u2014/);
  });

  it('requires Chrome 127 (chrome.action.openPopup) and points every icon at a file in public/', () => {
    expect(source.minimum_chrome_version).toBe('127');
    for (const path of [...Object.values(source.icons), ...Object.values(source.action.default_icon)]) {
      expect(existsSync(new URL(`../public/${path}`, import.meta.url))).toBe(true);
    }
  });

  it('declares the open-sieve shortcut with both suggested keys (50 section 8.9)', () => {
    expect(source.commands).toEqual({
      'open-sieve': {
        suggested_key: { default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' },
        description: 'Open or close Sieve',
      },
    });
  });

  it('carries a real key, not the placeholder', () => {
    expect(typeof source.key).toBe('string');
    expect(String(source.key)).not.toMatch(/^REPLACE/);
  });
});

describe('manifest transform (50 section 4.2)', () => {
  it('dev keeps both origins and the key; version comes from package.json', () => {
    const dev = transformManifest({ ...source, version: '9.9.9' }, 'dev', pkg.version);
    expect(dev.version).toBe(pkg.version);
    expect(dev.externally_connectable).toEqual({ matches: ['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*', 'http://localhost:5173/*'] });
    expect(dev.key).toBe(source.key);
  });

  it('release drops localhost and keeps the key', () => {
    const release = transformManifest(source, 'release', '1.2.3');
    expect(release.externally_connectable).toEqual({ matches: ['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*'] });
    expect(release.key).toBe(source.key);
    expect(release.version).toBe('1.2.3');
  });

  it('store drops localhost and the key', () => {
    const store = transformManifest(source, 'store', pkg.version);
    expect(store.externally_connectable).toEqual({ matches: ['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*'] });
    expect(store).not.toHaveProperty('key');
    expect(source).toHaveProperty('key'); // the source is never mutated
  });

  it('fails while the key holds the placeholder', () => {
    expect(() => transformManifest({ ...source, key: 'REPLACE_WITH_ONE_LINE_PUBLIC_KEY_FROM_THE_DEVELOPER_DASHBOARD' }, 'dev', '0.1.0')).toThrow();
  });

  it('ALLOWED_ORIGINS for each mode equals the origins of that mode manifest matches', () => {
    for (const mode of ['dev', 'release', 'store'] as const) {
      const m = transformManifest(source, mode, pkg.version) as { externally_connectable: { matches: string[] } };
      expect(m.externally_connectable.matches.map(originOfMatch)).toEqual([...MODES[mode].origins]);
    }
    expect([...ALLOWED_ORIGINS]).toEqual([...MODES.dev.origins]); // tests run with the dev constants
  });
});

describe('lint-dist patterns (50 section 12.4)', () => {
  it.each([
    '<script src="https://cdn.example/x.js"></script>',
    'import("https://cdn.example/x.js")',
    'importScripts("x.js")',
    'eval("1")',
    'new Function("return 1")',
    'fetch("https://x")',
    'new XMLHttpRequest()',
    'new WebSocket("wss://x")',
    'new EventSource("/x")',
    'el.innerHTML = s',
    'el.insertAdjacentHTML("beforeend", s)',
    'document.write("x")',
  ])('catches %s', (code) => {
    expect(findBanned(code)).not.toEqual([]);
  });

  it('skips only the exact React substrings on the allowlist', () => {
    expect(findBanned('mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>";')).toEqual([]);
    expect(findBanned('mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>"; x.innerHTML = y;')).toEqual(['innerHTML']);
  });

  it('rejects manifest keys and permissions outside the list', () => {
    expect(checkManifest({ ...source, host_permissions: ['<all_urls>'] })).toEqual(['manifest key not allowed: host_permissions']);
    expect(checkManifest({ ...source, permissions: ['sidePanel', 'tabs'] })).toEqual(['permission not allowed: tabs']);
  });
});

// 50 section 16, item 2: checked on the built packages when they exist (npm run build:all builds all three).
describe.each([
  ['dist-dev', ['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*', 'http://localhost:5173/*'], true],
  ['dist', ['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*'], true],
  ['dist-store', ['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*'], false],
] as const)('built %s/manifest.json', (dir, matches, keyed) => {
  const url = new URL(`../${dir}/manifest.json`, import.meta.url);
  it.skipIf(!existsSync(url))('has the three permissions, the right matches and key, and passes lint-dist', () => {
    const built = JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown> & {
      permissions: string[];
      externally_connectable: { matches: string[] };
      action: { default_popup?: string };
      side_panel: { default_path: string };
    };
    expect(built.action.default_popup).toBe('sidepanel/index.html');
    expect(built.side_panel.default_path).toBe('sidepanel/index.html');
    expect(existsSync(new URL(`../${dir}/sidepanel/index.html`, import.meta.url))).toBe(true);
    expect(built.minimum_chrome_version).toBe('127');
    expect([...built.permissions].sort()).toEqual(['notifications', 'sidePanel', 'storage']);
    expect(built).not.toHaveProperty('host_permissions');
    expect(built.externally_connectable.matches).toEqual([...matches]);
    expect('key' in built).toBe(keyed);
    expect(built.version).toBe(pkg.version);
    expect(checkManifest(built)).toEqual([]);
  });
});
