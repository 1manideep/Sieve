// Text helpers shared inside the privacy module: grapheme-safe cuts (11 section 4.7a rule 2, 70 R-EMO-04),
// sentence ranges, word lists for the verbatim and overlap checks.

export interface Range {
  start: number;
  end: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
let sentenceSegmenter: Intl.Segmenter | undefined;

function sentencesOf(): Intl.Segmenter {
  sentenceSegmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' });
  return sentenceSegmenter;
}

export function graphemes(s: string): string[] {
  return Array.from(graphemeSegmenter.segment(s), (g) => g.segment);
}

/** Longest prefix of whole graphemes within maxUnits UTF-16 units (the ellipsis counts toward the limit). */
export function cutGraphemes(s: string, maxUnits: number, ellipsis = ''): string {
  if (s.length <= maxUnits) return s;
  const budget = Math.max(0, maxUnits - ellipsis.length);
  let end = 0;
  for (const { index, segment } of graphemeSegmenter.segment(s)) {
    if (index + segment.length > budget) break;
    end = index + segment.length;
  }
  return s.slice(0, end) + ellipsis;
}

/** The last grapheme boundary at or before i. */
export function graphemeFloor(text: string, i: number): number {
  if (i <= 0) return 0;
  if (i >= text.length) return text.length;
  const seg = graphemeSegmenter.segment(text).containing(i);
  return seg ? seg.index : i;
}

/** Widens [start, end) so it never splits a grapheme (11 section 4.7a rule 4). */
export function snapToGraphemes(text: string, start: number, end: number): Range {
  const segs = graphemeSegmenter.segment(text);
  let s = Math.max(0, start);
  let e = Math.min(text.length, end);
  if (s > 0 && s < text.length) {
    const g = segs.containing(s);
    if (g) s = g.index;
  }
  if (e > 0 && e < text.length) {
    const g = segs.containing(e - 1);
    if (g) e = Math.max(e, g.index + g.segment.length);
  }
  return { start: s, end: e };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** String.prototype.isWellFormed (ES2024), written out because the web lib target is ES2023. */
export function isWellFormed(s: string): boolean {
  LONE_SURROGATE.lastIndex = 0;
  return !LONE_SURROGATE.test(s);
}

/** Repairs lone surrogates like toWellFormed(); returns whether a repair was needed (11 section 4.7a rule 3). */
export function ensureWellFormed(s: string): { text: string; repaired: boolean } {
  if (isWellFormed(s)) return { text: s, repaired: false };
  return { text: s.replace(LONE_SURROGATE, '�'), repaired: true };
}

const SPACE = /\s/;

/** Sentence ranges (trimmed), from Intl.Segmenter with an extra split at every newline (11 section 8.1). */
export function sentenceRanges(text: string): Range[] {
  const out: Range[] = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) {
      for (const seg of sentencesOf().segment(line)) {
        let a = seg.index;
        let b = seg.index + seg.segment.length;
        while (a < b && SPACE.test(line.charAt(a))) a++;
        while (b > a && SPACE.test(line.charAt(b - 1))) b--;
        if (b > a) out.push({ start: lineStart + a, end: lineStart + b });
      }
    }
    lineStart += line.length + 1;
  }
  return out;
}

/** Cuts s to at most max units at the last sentence end, else at a word boundary (adding "."), never inside a grapheme. */
export function cutAtSentence(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = cutGraphemes(s, max);
  let best = -1;
  for (const r of sentenceRanges(head)) {
    if (/[.!?]["')\]]*$/.test(head.slice(r.start, r.end))) best = r.end;
  }
  if (best > 0) return head.slice(0, best);
  const shorter = cutGraphemes(s, max - 1);
  const space = shorter.lastIndexOf(' ');
  const cut = (space > 0 ? shorter.slice(0, space) : shorter).replace(/[\s,;:]+$/, '');
  return cut + '.';
}

/** Words for the verbatim check (11 section 10.3). */
export function verbatimWords(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
}

/** 10 section 10.1 STOPWORDS: the list the overlap checks ignore. */
export const OVERLAP_STOPWORDS: ReadonlySet<string> = new Set(
  ('a an the and or but of to in on at by for with from is are was were be been it its this that these those you your yours ' +
    'i me my we our they them their he she his her as if so not no yes do does did can could will would should may might must ' +
    'has have had about into than then there here what when where which who whom how why also just only very more most some any all each per via')
    .split(' '),
);

/** Distinct content tokens for the 60% overlap rules (8.2 step 4, 10.4 step 5): numbers keep their digits only. */
export function overlapTokens(s: string): Set<string> {
  const joined = s.toLowerCase().replace(/(\d)[,.](?=\d)/g, '$1');
  const out = new Set<string>();
  for (const w of joined.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (!OVERLAP_STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function escapeRegExp(s: string): string {
  // Only the characters with a meaning in a pattern. A hyphen has none outside a character class, and with the `u`
  // flag "\-" there is a SyntaxError: every phone number, hyphenated name and receipt number made the masking throw,
  // which ended a request as an error or as "nothing to share" (Nov 21, 2026).
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** "1 piece" / "2 pieces". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}
