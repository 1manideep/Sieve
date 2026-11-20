// Bytes to text without mojibake or throws (70 section 3.2, R-MAIL-02, R-FILE-07, R-EMO-05). Pure; never throws.

export interface Decoded { text: string; encoding: string; lossy: boolean }

const UTF16_SNIFF_BYTES = 4096;
const UTF16_ZERO_SHARE = 0.3;
const UTF16_OTHER_MAX_SHARE = 0.1;
const UTF16_MIN_BYTES = 8;

function decoder(label: string, fatal = false): TextDecoder | null {
  try {
    return new TextDecoder(label, { fatal });
  } catch {
    return null;   // RangeError: an unknown label, or one that maps to the Encoding Standard's replacement encoding
  }
}

/** windows-1252 bytes 0x80 to 0x9F (the Encoding Standard's table); undefined entries map to the same code point. */
const CP1252_HIGH: readonly (number | undefined)[] = [
  0x20ac, undefined, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, undefined, 0x017d, undefined,
  undefined, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, undefined, 0x017e, 0x0178,
];

/**
 * windows-1252 by table, so the result is the same in Chrome and in Node (whose TextDecoder decodes this label as
 * ISO-8859-1, so 0x93 becomes U+0093 instead of a curly quote).
 */
function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    const codes = Array.from(chunk, (b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] ?? b : b));
    out += String.fromCharCode(...codes);
  }
  return out;
}

function run(label: string, bytes: Uint8Array): string | null {
  if (label === 'windows-1252') return decodeWindows1252(bytes);
  const d = decoder(label);
  if (d?.encoding === 'windows-1252') return decodeWindows1252(bytes);
  if (!d) return null;
  try {
    return d.decode(bytes);
  } catch {
    return null;
  }
}

/** Step 2: lower-cased, trimmed, quotes and an RFC 2231 language suffix removed, cp932 and ms932 as shift_jis. */
export function normalizeCharsetLabel(declared?: string): string | null {
  if (typeof declared !== 'string') return null;
  let l = declared.trim().toLowerCase().replace(/^["']+|["']+$/g, '').replace(/\*.*$/, '').trim();
  if (!l) return null;
  if (l === 'cp932' || l === 'ms932' || l === 'windows-31j') l = 'shift_jis';
  if (l === 'utf-7' || l === 'utf7' || l === 'unicode-1-1-utf-7') return null;   // browsers have no UTF-7
  return decoder(l) ? l : null;
}

function result(text: string, encoding: string): Decoded {
  return { text, encoding, lossy: text.includes('\uFFFD') };
}

/** Which UTF-16 byte order the zeros suggest (step 6), or null. */
function sniffUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, UTF16_SNIFF_BYTES);
  if (n < UTF16_MIN_BYTES) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) even++;
    else odd++;
  }
  const evenCount = Math.ceil(n / 2);
  const oddCount = Math.floor(n / 2);
  const oddShare = oddCount > 0 ? odd / oddCount : 0;
  const evenShare = evenCount > 0 ? even / evenCount : 0;
  // Zeros at one parity only: text. Zeros at both (a binary file renamed .txt) stay binary for the NUL check.
  if (oddShare >= UTF16_ZERO_SHARE && evenShare < UTF16_OTHER_MAX_SHARE) return 'utf-16le';   // ASCII in LE: "a\0b\0"
  if (evenShare >= UTF16_ZERO_SHARE && oddShare < UTF16_OTHER_MAX_SHARE) return 'utf-16be';
  return null;
}

/**
 * Order (first that applies wins): byte order mark; the declared label (unknown or replacement labels are dropped);
 * iso-2022-jp with ESC bytes; valid UTF-8 (unless the bytes look like UTF-16); the declared label; UTF-16 by zeros;
 * windows-1252. Never throws.
 */
export function decodeBytes(bytes: Uint8Array, declared?: string): Decoded {
  // ArrayBuffer.isView, not instanceof: bytes from another realm (a worker, a test DOM) are still bytes.
  const b = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(0);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return result(run('utf-8', b) ?? '', 'utf-8');
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return result(run('utf-16le', b) ?? '', 'utf-16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return result(run('utf-16be', b) ?? '', 'utf-16be');
  const label = normalizeCharsetLabel(declared);
  const canonical = label ? (decoder(label)?.encoding ?? label) : null;
  if (canonical === 'iso-2022-jp' && b.includes(0x1b)) {
    const t = run('iso-2022-jp', b);
    if (t !== null) return result(t, 'iso-2022-jp');
  }
  // ASCII-range UTF-16 without a BOM is also valid UTF-8 (NUL is a valid byte), so step 4 would never let step 6 run.
  // Text with 30% NUL bytes at one parity is not UTF-8 prose: skip step 4 for it (a deviation noted in the audit).
  const utf16 = sniffUtf16(b);
  const strict = utf16 ? null : decoder('utf-8', true);
  if (strict) {
    try {
      return result(strict.decode(b), 'utf-8');
    } catch {
      // not UTF-8
    }
  }
  if (label && canonical) {
    const t = run(label, b);
    if (t !== null) return result(t, canonical);
  }
  if (utf16) {
    const t = run(utf16, b);
    if (t !== null) return result(t, utf16);
  }
  return result(run('windows-1252', b) ?? '', 'windows-1252');
}

/** base64url (or base64) to bytes: whitespace removed, - and _ mapped, padded; null when it is not base64. */
export function decodeBase64UrlBytes(data: string): Uint8Array | null {
  if (typeof data !== 'string') return null;
  let s = data.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (s.length % 4 === 1) return null;
  while (s.length % 4 !== 0) s += '=';
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

type Piece = { kind: 'text'; text: string } | { kind: 'word'; charset: string; bytes: Uint8Array };

function qBytes(data: string): Uint8Array | null {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const ch = data[i] as string;
    if (ch === '_') out.push(0x20);
    else if (ch === '=') {
      const hex = data.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      out.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      const c = ch.charCodeAt(0);
      if (c > 0x7e) return null;
      out.push(c);
    }
  }
  return new Uint8Array(out);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * RFC 2047 encoded words (R-EMO-05). B is base64, Q is quoted-printable with _ as a space. Adjacent words separated
 * only by whitespace are joined without it; same-charset neighbours have their bytes joined before decodeBytes, so
 * an emoji split across two words survives. A malformed word is left as it is; a value with none is unchanged.
 */
export function decodeEncodedWords(headerValue: string): string {
  if (typeof headerValue !== 'string' || !headerValue.includes('=?')) return headerValue;
  const pieces: Piece[] = [];
  let last = 0;
  let any = false;
  for (const m of headerValue.matchAll(ENCODED_WORD)) {
    const at = m.index ?? 0;
    if (at > last) pieces.push({ kind: 'text', text: headerValue.slice(last, at) });
    const charset = (m[1] ?? '').replace(/\*.*$/, '').toLowerCase();
    const enc = (m[2] ?? '').toUpperCase();
    const data = m[3] ?? '';
    const bytes = enc === 'B' ? decodeBase64UrlBytes(data) : qBytes(data);
    if (bytes && charset) {
      pieces.push({ kind: 'word', charset, bytes });
      any = true;
    } else {
      pieces.push({ kind: 'text', text: m[0] });
    }
    last = at + m[0].length;
  }
  if (!any) return headerValue;
  if (last < headerValue.length) pieces.push({ kind: 'text', text: headerValue.slice(last) });
  const merged: Piece[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i] as Piece;
    const prev = merged[merged.length - 1];
    const next = pieces[i + 1];
    if (p.kind === 'text' && /^\s+$/.test(p.text) && prev?.kind === 'word' && next?.kind === 'word') continue;
    if (p.kind === 'word' && prev?.kind === 'word' && prev.charset === p.charset) {
      merged[merged.length - 1] = { kind: 'word', charset: prev.charset, bytes: concat(prev.bytes, p.bytes) };
      continue;
    }
    merged.push(p);
  }
  return merged.map((p) => (p.kind === 'text' ? p.text : decodeBytes(p.bytes, p.charset).text)).join('');
}
