#!/usr/bin/env node
// Fails when a built package contains remote code, network APIs or HTML sinks, or a manifest wider than
// 50 section 4 allows (50 section 12.4).
//
//   node scripts/lint-dist.mjs [dir ...]   default: every dist* folder that exists
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_MANIFEST_KEYS, ALLOWED_PERMISSIONS, MODES } from './modes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BANNED = [
  '<script src="http',
  'import("http',
  'importScripts(',
  'eval(',
  'new Function(',
  'fetch(',
  'XMLHttpRequest',
  'new WebSocket(',
  'new EventSource(',
  'innerHTML',
  'insertAdjacentHTML',
  'document.write(',
];

/**
 * Exact substrings that may contain a banned pattern, each with the file it comes from.
 * The pattern itself is never weakened: only these exact strings are skipped before matching.
 */
export const ALLOWLIST = [
  // react-dom 18.3.1, cjs/react-dom.production.min.js: the list of reserved prop names (the props React handles
  // itself, so they are never set as attributes).
  '"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style"',
  // react-dom 18.3.1, cjs/react-dom.production.min.js: setInnerHTML, the code path behind dangerouslySetInnerHTML,
  // which ESLint bans in extension/src (50 section 8.8), and its SVG fallback.
  'if ("http://www.w3.org/2000/svg" !== a.namespaceURI || "innerHTML" in a) a.innerHTML = b;',
  'mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>";',
  // react-dom 18.3.1, cjs/react-dom.production.min.js: createElement('script') goes through a div so the script
  // element never runs.
  'a.innerHTML = "<script><\\/script>"',
];

/**
 * @param {string} text
 * @returns {string[]} banned patterns found after removing allowlisted substrings
 */
export function findBanned(text) {
  let cleaned = text;
  for (const allowed of ALLOWLIST) cleaned = cleaned.split(allowed).join('');
  return BANNED.filter((pattern) => cleaned.includes(pattern));
}

/**
 * @param {Record<string, unknown>} manifest
 * @returns {string[]} problems
 */
export function checkManifest(manifest) {
  const problems = [];
  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_MANIFEST_KEYS.includes(key)) problems.push(`manifest key not allowed: ${key}`);
  }
  const permissions = manifest.permissions;
  if (!Array.isArray(permissions)) problems.push('manifest "permissions" missing');
  else {
    for (const p of permissions) if (!ALLOWED_PERMISSIONS.includes(p)) problems.push(`permission not allowed: ${p}`);
  }
  return problems;
}

/** @param {string} dir @param {string[]} [out] */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * @param {string} dir a built package folder
 * @returns {string[]} problems, as "file: message"
 */
export function lintDist(dir) {
  const problems = [];
  if (!existsSync(join(dir, 'manifest.json'))) return [`${dir}: no manifest.json (build first)`];
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  for (const p of checkManifest(manifest)) problems.push(`manifest.json: ${p}`);
  for (const file of walk(dir)) {
    if (!['.js', '.html', '.mjs'].includes(extname(file))) continue;
    for (const pattern of findBanned(readFileSync(file, 'utf8'))) {
      problems.push(`${relative(dir, file)}: contains ${JSON.stringify(pattern)}`);
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const dirs = args.length
    ? args.map((a) => (a.startsWith('/') ? a : join(process.cwd(), a)))
    : Object.values(MODES).map((m) => join(ROOT, m.out)).filter((d) => existsSync(d));
  if (dirs.length === 0) {
    console.error('lint-dist: nothing to check (build first)');
    process.exit(1);
  }
  let failed = false;
  for (const dir of dirs) {
    const problems = lintDist(dir);
    if (problems.length) {
      failed = true;
      console.error(`lint-dist: ${relative(ROOT, dir) || dir} failed`);
      for (const p of problems) console.error(`  ${p}`);
    } else {
      console.log(`lint-dist: ${relative(ROOT, dir) || dir} ok`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
