import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXTENSION_ID } from '@sieve/shared';
import { deriveExtensionId, readManifestKey } from '../scripts/ext-id.mjs';

/** The id Chromium reported for extension/manifest.json "key" (loaded unpacked through Playwright, Nov 18, 2026). */
export const MANIFEST_KEY_ID = 'ackgioeokfkdnehjoaoeldnpgodhljcc';

/** An independent pair: a throwaway public key and the id Chromium 159 reported when it was loaded unpacked. */
const VECTOR = {
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp4Mpm21Gg6LjzG/Ix3dMt2u5IFuqi1SrWcOXYl3+yKoE31WaBR88OeivBsgKP2QclUgdD2jy1lRtE9Mx3FQtS7PHm2nItt6DhdxwO/5K5+TJwTojc40QDjFaYbVzPlWWTs6jz5MPfLWx4x2uAWV4XkeB3iyOyeUxPOywW5BZW2YrOEqIiLtGr3HDBGf6TP0jCegKoM1bZnuMJsw8p/7oOG/hjmbrws2PDwPohE9MPAhja12w/qVDzP3G43bGT2IQWosCmSa9ldV846kk6jWAf1C1F3pIIZ/yKDPyltQ7nYzlCYNZKh3iyizRYaNgAvzh8IwmdFJE1R1ETDuV1msm8wIDAQAB',
  id: 'bdplipbimefcbiolamjnnlhibgkiodcl',
};

const PLACEHOLDER = EXTENSION_ID.startsWith('REPLACE');

describe('extension id (50 section 5)', () => {
  it('derives the id Chrome reports for a known key', () => {
    expect(deriveExtensionId(VECTOR.key)).toBe(VECTOR.id);
  });

  it('derives the id of the manifest key', () => {
    const id = deriveExtensionId(readManifestKey());
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(id).toBe(MANIFEST_KEY_ID);
  });

  it('ignores whitespace in a pasted key and rejects a non-key', () => {
    expect(deriveExtensionId(`${VECTOR.key.slice(0, 60)}\n ${VECTOR.key.slice(60)}`)).toBe(VECTOR.id);
    expect(() => deriveExtensionId('REPLACE_WITH_ONE_LINE_PUBLIC_KEY')).toThrow();
  });

  it('the manifest key is one line of base64', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as { key: string };
    expect(manifest.key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  // Runs once the shared constant holds the derived id (contract change request CR-1).
  it.skipIf(PLACEHOLDER)('EXTENSION_ID in @sieve/shared equals the id derived from the manifest key', () => {
    expect(EXTENSION_ID).toBe(deriveExtensionId(readManifestKey()));
  });
});
