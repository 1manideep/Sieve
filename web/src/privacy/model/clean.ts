// Hygiene for the browser model's spans, tuned on the corpus as 11 section 5.4.2 allows (measured in the WP3 report).
// Rampart was trained on chat text; on email it sometimes runs a span across a line break ("Whitfield\nThistlewick
// Prop"), includes the greeting ("Hi Alex"), stops inside a word, or tags a flight number as an address. Each rule
// below either narrows a span to what is personal or drops a span that is not; none hides less of a real detail.
import type { PiiSpan } from '@sieve/shared';
import { PII_STOPWORDS } from '../pii/merge';

const ORG_WORDS = new Set(['management', 'inc', 'llc', 'ltd', 'team', 'services', 'bank', 'group', 'support', 'office', 'department', 'company', 'property', 'health', 'clinic', 'store', 'desk', 'bot', 'medical', 'insurance', 'airlines', 'university', 'school']);
const NOT_PERSONAL_LABEL = /\b(?:order|invoice|tracking|booking|ticket|confirmation|reference|ref|meeting id|flight|gate|seat)\s*(?:number|no\.?|#)?\s*[:#]?\s*$/i;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function pieces(text: string, s: PiiSpan): PiiSpan[] {
  const out: PiiSpan[] = [];
  let start = s.start;
  for (let i = s.start; i <= s.end; i++) {
    if (i === s.end || text[i] === '\n') {
      if (i > start) out.push({ ...s, start, end: i });
      start = i + 1;
    }
  }
  return out;
}

function trimEdges(text: string, s: PiiSpan): PiiSpan | null {
  const value = text.slice(s.start, s.end);
  const lead = /^[^\p{L}\p{N}]+/u.exec(value)?.[0].length ?? 0;
  const trail = /[^\p{L}\p{N}]+$/u.exec(value)?.[0].length ?? 0;
  if (lead + trail >= value.length) return null;
  return { ...s, start: s.start + lead, end: s.end - trail };
}

/** Leading greeting or other stopwords are not part of a name ("Hi Alex" becomes "Alex"). */
function dropLeadingStopwords(text: string, s: PiiSpan): PiiSpan | null {
  let start = s.start;
  for (;;) {
    const m = /^([\p{L}']+)[\s,]+/u.exec(text.slice(start, s.end));
    if (!m || !PII_STOPWORDS.has(m[1]!.toLowerCase())) break;
    start += m[0].length;
  }
  return start < s.end ? { ...s, start } : null;
}

/** A span never ends or starts inside a word (over-hiding the rest of the word is the safe direction). */
function snapToWords(text: string, s: PiiSpan): PiiSpan {
  let { start, end } = s;
  while (start > 0 && WORD_CHAR.test(text[start - 1]!) && WORD_CHAR.test(text[start]!)) start--;
  while (end < text.length && WORD_CHAR.test(text[end]!) && WORD_CHAR.test(text[end - 1]!)) end++;
  return { ...s, start, end };
}

function words(value: string): string[] {
  return value.replace(EDGE, '').split(/[\s,.]+/).filter(Boolean);
}

/** Address pieces count only around a street name of at least four letters (so "SA 1432" and seat "14C" are not addresses). */
function keepAddresses(text: string, spans: PiiSpan[]): PiiSpan[] {
  const addresses = spans.filter((s) => s.type === 'address').sort((a, b) => a.start - b.start);
  const clusters: PiiSpan[][] = [];
  for (const s of addresses) {
    const last = clusters[clusters.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && /^[\s,.'’#-]{0,4}$/.test(text.slice(prev.end, s.start))) last!.push(s);
    else clusters.push([s]);
  }
  const keep = new Set<PiiSpan>();
  for (const c of clusters) {
    const hasStreet = c.some((s) => words(text.slice(s.start, s.end)).some((w) => /^\p{L}{4,}$/u.test(w)));
    if (hasStreet) for (const s of c) keep.add(s);
  }
  return spans.filter((s) => s.type !== 'address' || keep.has(s));
}

export function cleanModelSpans(text: string, spans: readonly PiiSpan[]): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const span of spans) {
    for (const piece of pieces(text, span)) {
      let s: PiiSpan | null = trimEdges(text, piece);
      if (s && s.type === 'name') s = dropLeadingStopwords(text, s);
      if (!s) continue;
      s = snapToWords(text, s);
      const value = text.slice(s.start, s.end);
      if (s.type === 'name' && words(value).some((w) => ORG_WORDS.has(w.toLowerCase()))) continue;
      if (s.type !== 'name' && s.type !== 'email' && NOT_PERSONAL_LABEL.test(text.slice(Math.max(0, s.start - 24), s.start))) continue;
      out.push(s);
    }
  }
  return keepAddresses(text, out);
}
