#!/usr/bin/env node
// Prints the extension id Chrome derives from manifest.json "key" (50 section 5.3).
//
//   node scripts/ext-id.mjs              prints the id
//   node scripts/ext-id.mjs --check <id> exits 1 when the derived id differs from <id>
//
// Chrome's rule: base64-decode the key (a DER SubjectPublicKeyInfo), SHA-256 it, take the first 16 bytes as
// 32 hex digits, and map each hex digit 0-9a-f to the letters a-p.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KEY_PLACEHOLDER_PREFIX = 'REPLACE_WITH';

/**
 * @param {string} base64Key the manifest "key" value, one line of base64
 * @returns {string} 32 letters a-p
 */
export function deriveExtensionId(base64Key) {
  const der = Buffer.from(base64Key.replace(/\s+/g, ''), 'base64');
  if (der.length < 64) throw new Error('manifest key is not a base64 DER public key');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  let id = '';
  for (const digit of hex) id += String.fromCharCode('a'.charCodeAt(0) + parseInt(digit, 16));
  return id;
}

/**
 * @param {URL | string} [manifestPath]
 * @returns {string}
 */
export function readManifestKey(manifestPath = new URL('../manifest.json', import.meta.url)) {
  /** @type {{ key?: unknown }} */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.key !== 'string' || manifest.key.startsWith(KEY_PLACEHOLDER_PREFIX)) {
    throw new Error('manifest.json "key" is not set (50 section 5.2)');
  }
  return manifest.key;
}

function main() {
  const id = deriveExtensionId(readManifestKey());
  const checkAt = process.argv.indexOf('--check');
  if (checkAt !== -1) {
    const expected = process.argv[checkAt + 1];
    if (id !== expected) {
      console.error(`extension id ${id} differs from ${expected ?? '(missing)'}`);
      process.exit(1);
    }
  }
  console.log(id);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
