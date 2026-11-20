// The excerpt step (11 section 10.4): the lines Nano picked, found verbatim in the item.
import type { IndexRecord } from '@sieve/shared';
import { EXCERPT_MAX_CHARS, QUOTE_OVERLAP_MIN } from '../constants';
import { overlapTokens, sentenceRanges, type Range } from '../text';

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
}

export function excerptHeader(record: Pick<IndexRecord, 'kind' | 'date'>): string {
  const noun = record.kind === 'email' ? 'an email' : record.kind === 'note' ? 'a note' : 'a document';
  return `Lines from ${noun} (${formatDate(record.date)}):`;
}

function stripWrapping(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/^(?:\.\.\.|…)+|(?:\.\.\.|…)+$/g, '').trim();
  }
  return t;
}

interface Collapsed { text: string; map: number[] }

/** Whitespace runs become one space; map[i] is the original index of collapsed character i. */
function collapse(s: string): Collapsed {
  let text = '';
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (/\s/.test(c)) {
      if (inSpace) continue;
      inSpace = true;
      text += ' ';
    } else {
      inSpace = false;
      text += c;
    }
    map.push(i);
  }
  return { text, map };
}

function toOriginal(c: Collapsed, start: number, end: number): Range {
  return { start: c.map[start] ?? 0, end: (c.map[end - 1] ?? 0) + 1 };
}

function findIn(c: Collapsed, needle: string, from = 0): number {
  const at = c.text.indexOf(needle, from);
  if (at >= 0) return at;
  const lower = c.text.toLowerCase();
  const n = needle.toLowerCase();
  return lower.length === c.text.length && n.length === needle.length ? lower.indexOf(n, from) : -1;
}

/** Expands a range to whole sentences and caps it at EXCERPT_MAX_CHARS, keeping whole sentences from `anchor`. */
function expandAndCap(text: string, sentences: Range[], range: Range, anchor?: number): Range {
  const touched = sentences.filter((s) => s.end > range.start && s.start < range.end);
  if (touched.length === 0) return range;
  const first = touched[0]!;
  const last = touched[touched.length - 1]!;
  if (last.end - first.start <= EXCERPT_MAX_CHARS) return { start: Math.min(first.start, range.start), end: Math.max(last.end, range.end) };
  const startIdx = anchor !== undefined ? Math.max(0, touched.findIndex((s) => s.start === anchor)) : 0;
  const from = touched[startIdx]!;
  let end = from.end;
  for (const s of touched.slice(startIdx + 1)) {
    if (s.end - from.start > EXCERPT_MAX_CHARS) break;
    end = s.end;
  }
  if (end - from.start > EXCERPT_MAX_CHARS) {                   // one sentence over the cap: its first words, a prefix of the item
    const cut = text.lastIndexOf(' ', from.start + EXCERPT_MAX_CHARS);
    end = cut > from.start ? cut : from.start + EXCERPT_MAX_CHARS;
  }
  return { start: from.start, end };
}

/** Where Nano's excerpt is in the record text (offsets into recordText), or null when it cannot be found. */
export function locateExcerpt(recordText: string, nanoExcerpt: string): Range | null {
  const needle = stripWrapping(nanoExcerpt);
  if (!needle || !recordText) return null;
  const hay = collapse(recordText);
  const n = collapse(needle).text.trim();
  const sentences = sentenceRanges(recordText);

  const at = findIn(hay, n);                                                     // exact, then case-insensitive
  if (at >= 0) return expandAndCap(recordText, sentences, toOriginal(hay, at, at + n.length));

  const pieces = needle.split(/\.\.\.|…/).map((p) => collapse(p).text.trim()).filter((p) => p.length >= 20);
  if (pieces.length > 1) {                                                       // pieces in order
    let from = 0;
    let start = -1;
    let end = -1;
    for (const p of pieces) {
      const i = findIn(hay, p, from);
      if (i < 0) {
        start = -1;
        break;
      }
      if (start < 0) start = i;
      end = i + p.length;
      from = end;
    }
    if (start >= 0 && end - start <= 1.5 * EXCERPT_MAX_CHARS) return expandAndCap(recordText, sentences, toOriginal(hay, start, end));
  }

  const want = overlapTokens(needle);                                            // fuzzy: sentences sharing 60% of their words
  const scored = sentences.map((s) => {
    const words = overlapTokens(recordText.slice(s.start, s.end));
    if (words.size < 3) return 0;
    let shared = 0;
    for (const w of words) if (want.has(w)) shared++;
    return shared / words.size;
  });
  const selected = scored.map((v, i) => (v >= QUOTE_OVERLAP_MIN ? i : -1)).filter((i) => i >= 0);
  if (selected.length === 0) return null;
  const firstSel = selected[0]!;
  const lastSel = selected[selected.length - 1]!;
  let bestIdx = firstSel;
  for (const i of selected) if (scored[i]! > scored[bestIdx]!) bestIdx = i;
  if (lastSel - firstSel + 1 <= 4) {
    return expandAndCap(recordText, sentences, { start: sentences[firstSel]!.start, end: sentences[lastSel]!.end }, sentences[bestIdx]!.start);
  }
  let best = { i: firstSel, len: 1, score: -1 };
  for (let i = 0; i < sentences.length; i++) {
    for (let len = 1; len <= 3 && i + len <= sentences.length; len++) {
      let score = 0;
      for (let k = i; k < i + len; k++) if (scored[k]! >= QUOTE_OVERLAP_MIN) score += scored[k]!;
      if (score > best.score) best = { i, len, score };
    }
  }
  return expandAndCap(recordText, sentences, { start: sentences[best.i]!.start, end: sentences[best.i + best.len - 1]!.end }, sentences[bestIdx]!.start);
}
