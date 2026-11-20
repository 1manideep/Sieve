// One cleaning step for every question (70 section 3.1), stored hints that are never trusted blindly (R-MCP-03),
// a parser-free entity decoder (R-MAIL-05) and grapheme-safe cuts (R-EMO-04).
// Pure: no DOM, no network, no storage. Every character count is in UTF-16 code units (CR-1).
import { MAX_QUESTION_CHARS, type QueryHints } from '@sieve/shared';
import { cleanChars } from '@/privacy/sanitize/chars';

export interface QuestionCheck {
  ok: boolean;
  text: string;            // the cleaned question: what is shown, searched and given to Nano
  removed: { invisible: number; bidi: number; tagText: string[]; html: boolean };
  error?: 'empty' | 'too-long';
}

/** Rounds of the clean pipeline until the text stops changing (a decoded entity can form a tag). Bounded (P5). */
const MAX_ROUNDS = 8;

/** Only these tags count as pasted HTML; "is 3 < 5" is untouched (3.1 step 3). */
const KNOWN_TAG = /<\/?(p|div|span|br|a|b|i|u|strong|em|table|tr|td|ul|ol|li|h[1-6]|font|img|style|script|blockquote)\b[^<>]{0,500}>/i;
const SCRIPT_BLOCK = /<script\b[^<>]{0,500}>[\s\S]*?<\/script\s*>/gi;
const STYLE_BLOCK = /<style\b[^<>]{0,500}>[\s\S]*?<\/style\s*>/gi;
const ANY_TAG = /<[^<>]{1,500}>/g;

const ENTITY = /&(?:#(\d{1,10})|#[xX]([0-9a-fA-F]{1,8})|(amp|lt|gt|quot|apos|nbsp));/g;
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** String.prototype.toWellFormed (ES2024, Chrome 111+), written out because the web lib target is ES2023. */
export function toWellFormed(s: string): string {
  return s.replace(LONE_SURROGATE, '\uFFFD');
}

/** String.prototype.isWellFormed, written out for the same reason. */
export function isWellFormed(s: string): boolean {
  LONE_SURROGATE.lastIndex = 0;
  const bad = LONE_SURROGATE.test(s);
  LONE_SURROGATE.lastIndex = 0;
  return !bad;
}

function validCodePoint(cp: number): boolean {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
}

/**
 * Exactly these entities: &amp; &lt; &gt; &quot; &#39; &apos; &nbsp;, &#NNN; and &#xHH;. A number that is not a valid
 * code point becomes U+FFFD. One pass, so "&amp;lt;" becomes "&lt;", never "<". No parser: nothing can be fetched.
 */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(ENTITY, (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name] ?? _m;
    const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
    return validCodePoint(cp) ? String.fromCodePoint(cp) : '\uFFFD';
  });
}

let graphemeSegmenter: Intl.Segmenter | undefined;

function segmenter(): Intl.Segmenter {
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return graphemeSegmenter;
}

/** The longest prefix of whole grapheme clusters within maxUnits UTF-16 code units (R-EMO-04). */
export function truncateGraphemes(s: string, maxUnits: number): string {
  const max = Math.floor(maxUnits);
  if (!(max > 0)) return '';
  if (s.length <= max) return s;
  let end = 0;
  for (const { index, segment } of segmenter().segment(s)) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  return s.slice(0, end);
}

function stripHtml(s: string): { text: string; html: boolean } {
  if (!KNOWN_TAG.test(s)) return { text: s, html: false };
  const text = s.replace(SCRIPT_BLOCK, ' ').replace(STYLE_BLOCK, ' ').replace(ANY_TAG, ' ');
  return { text: decodeEntities(text), html: true };
}

function zeroRemoved(): QuestionCheck['removed'] {
  return { invisible: 0, bidi: 0, tagText: [], html: false };
}

/**
 * Steps of 3.1, in order: well-formed, pasted HTML, cleanChars (11 section 4.7), whitespace, NFC, then the empty and
 * length checks. Repeated until nothing changes, so the result is a fixed point (idempotent). Never truncates.
 */
export function normalizeQuestion(raw: unknown): QuestionCheck {
  if (typeof raw !== 'string') return { ok: false, text: '', removed: zeroRemoved(), error: 'empty' };
  const removed = zeroRemoved();
  let s = raw;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const before = s;
    let t = toWellFormed(s);
    const h = stripHtml(t);
    t = h.text;
    if (h.html) removed.html = true;
    const c = cleanChars(t);
    removed.invisible += c.invisibleInWords;
    removed.bidi += c.bidi;
    removed.tagText.push(...c.tagText);
    t = c.text.replace(/\s+/gu, ' ').trim().normalize('NFC');
    s = t;
    if (s === before) break;
  }
  if (s.length === 0) return { ok: false, text: '', removed, error: 'empty' };
  if (s.length > MAX_QUESTION_CHARS) return { ok: false, text: s, removed, error: 'too-long' };
  return { ok: true, text: s, removed };
}

// ---------- stored hints (R-MCP-03): the rules of 30 section 8.7, invalid fields dropped ----------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CC_OR_CF = /[\p{Cc}\p{Cf}]/u;
const FROM_MAX_UNITS = 100;
const TERM_MAX_UNITS = 64;
const TERMS_MAX = 5;

function realDay(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  const m = DAY_RE.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1) return undefined;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined;
  return s;
}

function plainText(v: unknown, maxUnits: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (s.length < 1 || s.length > maxUnits || CC_OR_CF.test(s) || !isWellFormed(s)) return undefined;
  return s;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Stored request hints, checked field by field with 30 section 8.7's rules. A field that fails is dropped (hints only
 * boost, P7, so dropping is always safe). `after` later than `before` drops both. `now` enables the "after cannot be
 * in the future" rule (server UTC date plus one day). Undefined when nothing survives. Never throws.
 */
export function parseStoredHints(raw: unknown, now?: number): QueryHints | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const h = raw as Record<string, unknown>;
  const out: QueryHints = {};
  let after = realDay(h.after);
  let before = realDay(h.before);
  if (after && before && after > before) {
    after = undefined;
    before = undefined;
  }
  if (after && now !== undefined && Number.isFinite(now) && after > utcDay(now + 86_400_000)) after = undefined;
  if (after) out.after = after;
  if (before) out.before = before;
  if (h.source === 'mail' || h.source === 'files' || h.source === 'photos') out.source = h.source;
  const from = plainText(h.from, FROM_MAX_UNITS);
  if (from) out.from = from;
  if (Array.isArray(h.terms)) {
    // Entry by entry: a non-string, empty, too long or invisible-character entry is dropped, duplicates too, and at
    // most 5 are kept (a stored doc is already past 30's checks; an older writer must not cost the valid terms).
    const terms: string[] = [];
    for (const t of h.terms as unknown[]) {
      const s = plainText(t, TERM_MAX_UNITS);
      if (s && !terms.includes(s)) terms.push(s);
      if (terms.length === TERMS_MAX) break;
    }
    if (terms.length > 0) out.terms = terms;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
