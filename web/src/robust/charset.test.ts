// 70 section 3.2 with gmail/charset-*.json, gmail/subject-encoded.json and the files/ text corpus.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bytesOf, forAll, pick } from '../../../tests/harness/property';
import { corpus, corpusBytes, ROBUST_DIR } from '../../../tests/harness/robustCorpus';
import { decodeBase64UrlBytes, decodeBytes, decodeEncodedWords, normalizeCharsetLabel } from './charset';
import { isWellFormed } from './question';

interface Part { mimeType?: string; headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: Part[] }

function firstTextPart(p: Part): Part | undefined {
  if (p.mimeType?.startsWith('text/')) return p;
  for (const c of p.parts ?? []) {
    const t = firstTextPart(c);
    if (t) return t;
  }
  return undefined;
}

const charsetOf = (p: Part) => /charset\s*=\s*"?([^";\s]+)"?/i.exec(p.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '')?.[1];

describe('decodeBytes: gmail/charset-*.json (R-MAIL-02)', () => {
  const files = readdirSync(join(ROBUST_DIR, 'gmail')).filter((f) => f.startsWith('charset-')).sort();
  it('has the 13 charset fixtures', () => expect(files).toHaveLength(13));
  for (const f of files) {
    for (const c of corpus<{ payload: Part }, { text: string }>(`gmail/${f}`).cases) {
      it(c.id, () => {
        const part = firstTextPart(c.input.payload);
        expect(part?.body?.data).toBeTypeOf('string');
        const bytes = decodeBase64UrlBytes(part?.body?.data ?? '');
        expect(bytes).not.toBeNull();
        let out = '';
        expect(() => {
          out = decodeBytes(bytes as Uint8Array, charsetOf(part as Part)).text;
        }).not.toThrow();
        expect(out).toBe(c.expected.text);
      });
    }
  }
});

describe('decodeBytes order', () => {
  const ascii = new TextEncoder().encode('deposit');
  it('byte order marks win and are stripped', () => {
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...ascii]))).toMatchObject({ text: 'deposit', encoding: 'utf-8' });
    expect(decodeBytes(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toMatchObject({ text: 'a', encoding: 'utf-16le' });
    expect(decodeBytes(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toMatchObject({ text: 'a', encoding: 'utf-16be' });
  });
  it('valid UTF-8 wins over a declared single-byte label (V3)', () => {
    expect(decodeBytes(new TextEncoder().encode('café'), 'iso-8859-1').text).toBe('café');
  });
  it('iso-8859-1 means windows-1252, as mail clients mean it', () => {
    expect(decodeBytes(new Uint8Array([0x80]), 'iso-8859-1')).toMatchObject({ text: '€', encoding: 'windows-1252' });
  });
  it('UTF-16 without a byte order mark is found by its zeros', () => {
    const le = new Uint8Array([0x4c, 0, 0x65, 0, 0x61, 0, 0x73, 0, 0x65, 0]);
    expect(decodeBytes(le)).toMatchObject({ text: 'Lease', encoding: 'utf-16le' });
    const be = new Uint8Array([0, 0x4c, 0, 0x65, 0, 0x61, 0, 0x73, 0, 0x65]);
    expect(decodeBytes(be)).toMatchObject({ text: 'Lease', encoding: 'utf-16be' });
  });
  it('anything else falls back to windows-1252 and reports lossy text', () => {
    expect(decodeBytes(new Uint8Array([0x93, 0x61, 0x94]))).toMatchObject({ text: '“a”', encoding: 'windows-1252', lossy: false });
    expect(decodeBytes(new Uint8Array([0xe2, 0x82]), 'utf-8').lossy).toBe(true);
  });
  it('labels: unknown, replacement, utf-7 and quoted', () => {
    expect(normalizeCharsetLabel('"UTF-8"')).toBe('utf-8');
    expect(normalizeCharsetLabel('CP932')).toBe('shift_jis');
    expect(normalizeCharsetLabel('utf-8*en')).toBe('utf-8');
    for (const l of ['iso-2022-kr', 'utf-7', 'x-unknown', '', undefined]) expect(normalizeCharsetLabel(l)).toBeNull();
  });
});

describe('decodeBase64UrlBytes', () => {
  it('maps the URL alphabet, pads, ignores whitespace', () => {
    expect(Array.from(decodeBase64UrlBytes('-_8') ?? [])).toEqual([0xfb, 0xff]);
    expect(new TextDecoder().decode(decodeBase64UrlBytes('ZGVw\nb3NpdA') ?? new Uint8Array())).toBe('deposit');
  });
  it('null when not base64', () => {
    for (const s of ['!!!***', 'A', '%%%%']) expect(decodeBase64UrlBytes(s)).toBeNull();
  });
});

describe('decodeEncodedWords: gmail/subject-encoded.json (R-EMO-05)', () => {
  for (const c of corpus<string, string>('gmail/subject-encoded.json').cases) {
    it(c.id, () => expect(decodeEncodedWords(c.input)).toBe(c.expected));
  }
  it('is safe to call twice', () => {
    const once = decodeEncodedWords('=?UTF-8?B?8J+OgiBQYXJ0eQ==?=');
    expect(decodeEncodedWords(once)).toBe(once);
  });
});

describe('decodeBytes: files/ text corpus (R-FILE-07)', () => {
  type FileCase = { text?: string; skip?: string; declared?: string };
  const textCases = corpus<string, FileCase>('files/expected.json').cases.filter((c) => /^notes-|^binary\.dat|^empty\.txt/.test(c.id));
  for (const c of textCases) {
    it(c.id, () => {
      const bytes = corpusBytes(c.input);
      expect(bytes).not.toBeNull();
      const d = decodeBytes(bytes as Uint8Array, c.expected.declared);
      if (c.expected.text !== undefined) expect(d.text).toBe(c.expected.text);
      if (c.expected.skip === 'binary') {
        // the binary check (NUL in the first 1,024 bytes) runs only when the chosen encoding is not UTF-16
        expect(d.encoding.startsWith('utf-16')).toBe(false);
        expect((bytes as Uint8Array).subarray(0, 1024).includes(0)).toBe(true);
      }
    });
  }
});

describe('properties (70 section 15.7)', () => {
  const LABELS = [undefined, 'utf-8', 'iso-8859-1', 'shift_jis', 'iso-2022-jp', 'iso-2022-kr', 'utf-7', 'x-unknown', 'utf-16le', 'euc-kr', 'gb18030', 'koi8-r', ' "Windows-1252" '];
  it('decodeBytes never throws and returns well-formed text for random bytes and labels', () => {
    forAll((r) => ({ bytes: bytesOf(r, 64), label: pick(r, LABELS) }), ({ bytes, label }) => {
      const d = decodeBytes(bytes, label);
      expect(isWellFormed(d.text)).toBe(true);
      expect(d.lossy).toBe(d.text.includes('\uFFFD'));
    });
  });
});
