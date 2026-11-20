// Chunking and embedding inputs (20 sections 7.1 to 7.3).
import { CHUNK_WORDS } from '@sieve/shared';
import type { CategoryRule, IndexRecord } from '@sieve/shared';
import { CHUNK_OVERLAP_MAX_WORDS, MAX_CHUNKS_PER_RECORD } from './config';
import { cyrb53 } from './hash';
import { displayName, withEmojiNames } from './text';

export interface Chunk { n: number; start: number; end: number; text: string }

interface Span { start: number; end: number; words: number; block: number }

const WORD = /\S+/g;

function countWords(s: string): number {
  return s.match(WORD)?.length ?? 0;
}

/** Sentence spans with offsets, each tagged with its block (paragraph or list item). */
function sentenceSpans(text: string): Span[] {
  const cuts = new Set<number>([0, text.length]);
  const blockStarts = new Set<number>([0]);
  for (const m of text.matchAll(/[.!?](?=\s)/g)) cuts.add(m.index + 1);
  for (const m of text.matchAll(/\n\s*\n/g)) {
    cuts.add(m.index);
    cuts.add(m.index + m[0].length);
    blockStarts.add(m.index + m[0].length);
  }
  for (const m of text.matchAll(/\n(?=(?:[-*•] |\d+[.)] ))/g)) {
    cuts.add(m.index);
    blockStarts.add(m.index + 1);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const starts = [...blockStarts].sort((a, b) => a - b);
  const spans: Span[] = [];
  let block = 0;
  let bi = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    let s = sorted[i] ?? 0;
    let e = sorted[i + 1] ?? 0;
    while (s < e && /\s/.test(text[s] ?? '')) s++;
    while (e > s && /\s/.test(text[e - 1] ?? '')) e--;
    if (e <= s) continue;
    while (bi < starts.length && (starts[bi] ?? 0) <= s) {
      block = bi;
      bi++;
    }
    spans.push({ start: s, end: e, words: countWords(text.slice(s, e)), block });
  }
  return spans;
}

/** A span over 1.5 x maxWords words becomes windows of maxWords words at word boundaries. */
function splitLong(text: string, span: Span, maxWords: number): Span[] {
  if (span.words <= maxWords * 1.5) return [span];
  const words = [...text.slice(span.start, span.end).matchAll(WORD)];
  const out: Span[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const first = words[i];
    const last = words[Math.min(i + maxWords, words.length) - 1];
    if (!first || !last) continue;
    out.push({
      start: span.start + first.index,
      end: span.start + last.index + last[0].length,
      words: Math.min(maxWords, words.length - i),
      block: span.block,
    });
  }
  return out;
}

/**
 * Packs sentence spans into chunks of at most maxWords words (20 section 7.1). A chunk also closes early at a
 * block boundary (paragraph or list item) when the next block does not fit in it but fits in a fresh chunk,
 * so a short numbered section stays whole in one chunk. Offsets are UTF-16 units into `text`.
 */
export function chunkText(text: string, maxWords: number = CHUNK_WORDS): Chunk[] {
  if (!text || !text.trim()) return [];
  const spans = sentenceSpans(text).flatMap((s) => splitLong(text, s, maxWords));
  if (spans.length === 0) return [];
  const total = spans.reduce((n, s) => n + s.words, 0);
  if (total <= maxWords) {
    const first = spans[0];
    const last = spans[spans.length - 1];
    if (!first || !last) return [];
    return [{ n: 0, start: first.start, end: last.end, text: text.slice(first.start, last.end) }];
  }
  const blockWords = new Map<number, number>();
  for (const s of spans) blockWords.set(s.block, (blockWords.get(s.block) ?? 0) + s.words);

  const chunks: Chunk[] = [];
  let cur: Span[] = [];
  let curWords = 0;
  const emit = () => {
    const first = cur[0];
    const last = cur[cur.length - 1];
    if (first && last) chunks.push({ n: chunks.length, start: first.start, end: last.end, text: text.slice(first.start, last.end) });
  };
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!s) continue;
    const prev = cur[cur.length - 1];
    const startsBlock = !!prev && prev.block !== s.block;
    const blockSize = blockWords.get(s.block) ?? s.words;
    const overflow = cur.length > 0 && curWords + s.words > maxWords;
    const blockBreak = startsBlock && cur.length > 0 && curWords + blockSize > maxWords && blockSize <= maxWords;
    if (overflow || blockBreak) {
      emit();
      if (chunks.length >= MAX_CHUNKS_PER_RECORD) return chunks;
      const last = cur[cur.length - 1];
      if (last && last.words <= CHUNK_OVERLAP_MAX_WORDS && last.words + s.words <= maxWords && last.block === s.block) {
        cur = [last];
        curWords = last.words;
      } else {
        cur = [];
        curWords = 0;
      }
    }
    cur.push(s);
    curWords += s.words;
  }
  if (cur.length > 0 && chunks.length < MAX_CHUNKS_PER_RECORD) emit();
  return chunks;
}

export interface EmbedPlan { chunks: Chunk[]; inputs: string[]; sourceHash: string }

function headerOf(rec: IndexRecord): string {
  if (rec.kind === 'email') return `${rec.title}\n${displayName(rec.from)}\n`;
  return `${rec.title}\n`;
}

/**
 * What gets embedded for a record (20 sections 7.2 and 7.3). Emoji names are added to the inputs only.
 * A record whose rule is never is embedded from title and sender only, so no model reads its content.
 */
export function embedTexts(rec: IndexRecord, rule: CategoryRule): EmbedPlan {
  let chunks: Chunk[];
  let inputs: string[];
  const header = headerOf(rec);
  if (rule === 'never') {
    chunks = [{ n: 0, start: 0, end: 0, text: '' }];
    inputs = [withEmojiNames(header.trim())];
  } else if (rec.kind === 'photo') {
    if (!rec.caption) {
      chunks = [];
      inputs = [];
    } else {
      chunks = [{ n: 0, start: 0, end: 0, text: '' }];
      inputs = [withEmojiNames('Photo: ' + rec.caption)];
    }
  } else if (rec.text && rec.text.trim()) {
    chunks = chunkText(rec.text);
    inputs = chunks.map((c) => withEmojiNames(header + c.text));
  } else {
    chunks = [{ n: 0, start: 0, end: 0, text: '' }];
    inputs = [withEmojiNames((header + (rec.kind === 'email' ? rec.preview : '')).trim())];
  }
  return { chunks, inputs, sourceHash: cyrb53(inputs.join('\u0001')).toString(36) };
}
