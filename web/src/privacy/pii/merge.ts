// Filters, merge and propagation (11 section 5.6).
import type { PiiSpan, PiiType } from '@sieve/shared';
import { escapeRegExp } from '../text';
import { isProtectedValue } from './protected';

export const TYPE_RANK: readonly PiiType[] = ['secret-code', 'card', 'iban', 'ssn', 'account', 'email', 'phone', 'dob', 'address', 'name', 'other'];
export const BY_RANK: readonly PiiSpan['by'][] = ['validator', 'model', 'nano'];

export const PII_STOPWORDS: ReadonlySet<string> = new Set(
  ('a an and or but if then so to of in on at by for with from as is are was were be been it this that these those you your we our ' +
    'they their he she him her i me my hi hello dear thanks thank best regards please will may can could would should must shall team ' +
    'all everyone there here today tomorrow yesterday mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday')
    .split(' '),
);
export const MONTH_NAMES: ReadonlySet<string> = new Set('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));
const WEEKDAYS: ReadonlySet<string> = new Set('monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun'.split(' '));
const TITLES: ReadonlySet<string> = new Set(['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof']);

export function isStopwordOrCalendarWord(s: string): boolean {
  const t = s.trim().toLowerCase();
  return PII_STOPWORDS.has(t) || MONTH_NAMES.has(t) || WEEKDAYS.has(t);
}

/** Step 1: drop empty, out-of-range, protected (model and Nano), stopword, month-near-digit and very short name spans. */
export function filterSpans(text: string, spans: readonly PiiSpan[]): PiiSpan[] {
  return spans.filter((s) => {
    if (!(s.end > s.start) || s.start < 0 || s.end > text.length) return false;
    const value = text.slice(s.start, s.end);
    if (s.by !== 'validator' && s.type !== 'dob' && isProtectedValue(value)) return false;
    if (s.type === 'name') {
      const low = value.trim().toLowerCase();
      if (PII_STOPWORDS.has(low) || value.trim().length <= 2) return false;
      if (MONTH_NAMES.has(low) && /\d/.test(text.slice(Math.max(0, s.start - 2), s.start) + text.slice(s.end, s.end + 2))) return false;
    }
    return true;
  });
}

function higher<T>(rank: readonly T[], a: T, b: T): T {
  return rank.indexOf(a) <= rank.indexOf(b) ? a : b;
}

/** Step 2: overlapping spans become one span over the union; the highest type and `by` win; the best score is kept. */
export function mergeSpans(spans: readonly PiiSpan[]): PiiSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out: PiiSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.type = higher(TYPE_RANK, last.type, s.type);
      last.by = higher(BY_RANK, last.by, s.by);
      const scores = [last.score, s.score].filter((x): x is number => x !== undefined);
      if (scores.length > 0) last.score = Math.max(...scores);
      else delete last.score;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}])';
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}])';

function isUpper(ch: string | undefined): boolean {
  return ch !== undefined && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

/** Step 3: other occurrences of found names, addresses and ids; words of multi-word names (Dana Lee hides a later Dana). */
export function propagateEntities(text: string, spans: readonly PiiSpan[]): PiiSpan[] {
  const out = [...spans];
  const seen = new Set<string>();
  for (const s of spans) {
    if (s.type !== 'name' && s.type !== 'address' && s.type !== 'other') continue;
    const value = text.slice(s.start, s.end).trim();
    if (!value) continue;
    const key = `${s.type}\u0000${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pattern = escapeRegExp(value).replace(/\s+/g, '\\s+');
    for (const m of text.matchAll(new RegExp(`${WORD_EDGE_BEFORE}${pattern}${WORD_EDGE_AFTER}`, 'giu'))) {
      if (s.type === 'name' && !isUpper(m[0][0])) continue;
      out.push({ ...s, start: m.index, end: m.index + m[0].length });
    }
    if (s.type === 'name') {
      const words = value.split(/\s+/);
      if (words.length < 2) continue;
      for (const w of words) {
        if ([...w.matchAll(/\p{L}/gu)].length < 3 || !isUpper(w[0]) || PII_STOPWORDS.has(w.toLowerCase()) || TITLES.has(w.replace(/\.$/, ''))) continue;
        for (const m of text.matchAll(new RegExp(`${WORD_EDGE_BEFORE}${escapeRegExp(w)}${WORD_EDGE_AFTER}`, 'gu'))) {
          out.push({ ...s, start: m.index, end: m.index + m[0].length });
        }
      }
    }
  }
  return out;
}

/** filter, merge, propagate, merge again (5.6). */
export function finalizeSpans(text: string, spans: readonly PiiSpan[]): PiiSpan[] {
  return mergeSpans(propagateEntities(text, mergeSpans(filterSpans(text, spans))));
}
