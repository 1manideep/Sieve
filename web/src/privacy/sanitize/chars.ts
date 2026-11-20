// cleanChars() and foldForMatch() (11 sections 4.7 and 4.7a). Iterates by code point, never by UTF-16 unit.

export interface CleanResult {
  text: string;
  invisibleInWords: number;
  bidi: number;
  tagText: string[];
}

const ZERO_WIDTH = new Set([0x200b, 0x2060, 0xfeff, 0x180e, 0x2061, 0x2062, 0x2063, 0x2064, 0x034f, 0x115f, 0x1160, 0x3164, 0xffa0]);
const BIDI = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]);
const UNUSUAL_SPACES = new Set([0x00a0, 0x1680, 0x202f, 0x205f, 0x3000, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a]);

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const LETTER = /^\p{L}$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const LATIN = /^\p{Script=Latin}$/u;
const EMOJI_JOINABLE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️)$/u;
const ASCII_ALNUM = /^[A-Za-z0-9]$/;

function isControl(cp: number): boolean {
  return (cp <= 0x08) || cp === 0x0b || cp === 0x0c || (cp >= 0x0e && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f);
}

function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

function test(re: RegExp, ch: string | undefined): boolean {
  return ch !== undefined && re.test(ch);
}

/** Removes invisible and control characters, keeps emoji intact, and reports what it removed. Idempotent. */
export function cleanChars(input: string): CleanResult {
  const chars = Array.from(input.replace(/\r\n?/g, '\n'));
  const n = chars.length;
  const out: string[] = [];
  let invisibleInWords = 0;
  let bidi = 0;
  const tagText: string[] = [];
  let i = 0;
  while (i < n) {
    const ch = chars[i]!;
    const cp = ch.codePointAt(0)!;
    const prev = i > 0 ? chars[i - 1] : undefined;
    const next = i + 1 < n ? chars[i + 1] : undefined;

    if (ZERO_WIDTH.has(cp)) {
      if (test(LETTER_OR_DIGIT, prev) && test(LETTER_OR_DIGIT, next)) invisibleInWords++;
      i++;
      continue;
    }
    if (cp === 0x00ad) {                                   // soft hyphen: a legitimate hyphenation hint
      i++;
      continue;
    }
    if (cp === 0x200c || cp === 0x200d) {                  // ZWNJ, ZWJ
      let keep = test(LETTER_OR_MARK, prev) && test(LETTER_OR_MARK, next) && !test(LATIN, prev) && !test(LATIN, next);
      if (cp === 0x200d && test(EMOJI_JOINABLE, prev) && test(EMOJI_JOINABLE, next)) keep = true;
      if (keep) out.push(ch);
      else if (test(LETTER, prev) && test(LETTER, next)) invisibleInWords++;
      i++;
      continue;
    }
    if (BIDI.has(cp)) {
      bidi++;
      i++;
      continue;
    }
    if (cp >= 0xe0000 && cp <= 0xe007f) {                 // Unicode tag characters
      if (prev === '\u{1F3F4}') {                          // a subdivision flag: 2 to 6 tags a-z/0-9, then CANCEL TAG
        let j = i;
        while (j < n) {
          const t = chars[j]!.codePointAt(0)!;
          if ((t >= 0xe0061 && t <= 0xe007a) || (t >= 0xe0030 && t <= 0xe0039)) j++;
          else break;
        }
        if (j - i >= 2 && j - i <= 6 && j < n && chars[j]!.codePointAt(0) === 0xe007f) {
          for (let k = i; k <= j; k++) out.push(chars[k]!);
          i = j + 1;
          continue;
        }
      }
      let j = i;
      let decoded = '';
      while (j < n) {
        const t = chars[j]!.codePointAt(0)!;
        if (t < 0xe0000 || t > 0xe007f) break;
        if (t >= 0xe0020 && t <= 0xe007e) decoded += String.fromCodePoint(t - 0xe0000);
        j++;
      }
      if (decoded.length >= 2) tagText.push(decoded);
      i = j;
      continue;
    }
    if (isVariationSelector(cp)) {
      let j = i;
      while (j < n && isVariationSelector(chars[j]!.codePointAt(0)!)) j++;
      if (j - i >= 2) {
        invisibleInWords++;
        i = j;
        continue;
      }
      if (test(ASCII_ALNUM, prev) && !(cp === 0xfe0f && next === '⃣')) {
        i++;
        continue;
      }
      out.push(ch);
      i++;
      continue;
    }
    if (isControl(cp) && ch !== '\n' && ch !== '\t') {
      i++;
      continue;
    }
    if (UNUSUAL_SPACES.has(cp)) {
      out.push(' ');
      i++;
      continue;
    }
    if (cp === 0x2028 || cp === 0x2029) {
      out.push('\n');
      i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return { text: out.join(''), invisibleInWords, bidi, tagText };
}

/** Per line: collapse runs of spaces and tabs, trim; at most one blank line in a row; trim; NFC (4.7). */
export function normalizeWhitespace(s: string): string {
  const lines = s.split('\n').map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().normalize('NFC');
}

const CONFUSABLES: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd',
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  '‘': "'", '’': "'", '“': '"', '”': '"',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's' };
const HAS_LETTER = /\p{L}/u;

/** Folds text for pattern matching only; never stored or shown (4.7). */
export function foldForMatch(s: string): string {
  let t = cleanChars(s).text.normalize('NFKC').toLowerCase();
  t = t.normalize('NFD').replace(/\p{M}/gu, '');
  t = t.replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c);
  t = t.replace(/\S+/g, (tok) => (HAS_LETTER.test(tok) ? tok.replace(/[013457$]/g, (c) => LEET[c] ?? c) : tok));
  t = t.replace(/\b(?:\p{L}[ .\-_*]){3,}\p{L}\b/gu, (m) => m.replace(/[ .\-_*]/g, ''));
  return t.replace(/\s+/g, ' ');
}
