// Grapheme-safe cuts and emoji names (20 section 7.5). Every shortening in the index uses cutGraphemes.
import EMOJI_NAMES from './emoji-names.json';

const NAMES = EMOJI_NAMES as Record<string, string>;
let segmenter: Intl.Segmenter | null = null;

function seg(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter;
}

export function graphemes(s: string): string[] {
  const out: string[] = [];
  for (const part of seg().segment(s)) out.push(part.segment);
  return out;
}

/** Longest prefix of whole graphemes within maxUnits UTF-16 units; the ellipsis (when added) counts. */
export function cutGraphemes(s: string, maxUnits: number, ellipsis = ''): string {
  if (s.length <= maxUnits) return s;
  const budget = maxUnits - ellipsis.length;
  if (budget <= 0) return ellipsis.length <= maxUnits ? ellipsis : '';
  let out = '';
  for (const part of seg().segment(s)) {
    if (out.length + part.segment.length > budget) break;
    out += part.segment;
  }
  return out + ellipsis;
}

/** Cut at a word boundary when one is near the end (within the last 40 units), then add the ellipsis. */
export function cutAtWord(s: string, maxUnits: number, ellipsis = '…'): string {
  if (s.length <= maxUnits) return s;
  const cut = cutGraphemes(s, maxUnits - ellipsis.length);
  const lastSpace = cut.search(/\s\S*$/);
  const base = lastSpace > 0 && cut.length - lastSpace <= 40 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.]+$/, '') + ellipsis;
}

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const SKIN_TONES = /[\u{1F3FB}-\u{1F3FF}]/gu;

export function isEmojiGrapheme(g: string): boolean {
  return EMOJI_RE.test(g);
}

function lookup(g: string): string | undefined {
  if (NAMES[g]) return NAMES[g];
  const noVs = g.replace(/️/g, '');
  if (NAMES[noVs]) return NAMES[noVs];
  const first = String.fromCodePoint(g.codePointAt(0) ?? 0);
  const withVs = first + '️' + g.slice(first.length);
  if (NAMES[withVs]) return NAMES[withVs];
  const bare = g.replace(SKIN_TONES, '').replace(/️/g, '');
  if (NAMES[bare]) return NAMES[bare];
  const bareVs = bare.length > 0 ? String.fromCodePoint(bare.codePointAt(0) ?? 0) + '️' + bare.slice(String.fromCodePoint(bare.codePointAt(0) ?? 0).length) : '';
  return bareVs ? NAMES[bareVs] : undefined;
}

/** Names of the emoji graphemes in s, deduped, in order. Unknown emoji add no name. */
export function emojiNames(s: string): string[] {
  if (!EMOJI_RE.test(s)) return [];
  const out: string[] = [];
  for (const g of graphemes(s)) {
    if (!isEmojiGrapheme(g)) continue;
    const name = lookup(g);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** s plus " (name, name)" when s has emoji; else s unchanged. Only for index documents and embedded text. */
export function withEmojiNames(s: string): string {
  const names = emojiNames(s);
  return names.length > 0 ? `${s} (${names.join(', ')})` : s;
}

/** Length in UTF-8 bytes. */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** "Name <address>" to "Name"; a bare address stays as is. */
export function displayName(from: string | undefined): string {
  if (!from) return '';
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(from);
  const name = m?.[1]?.trim();
  return name || from.replace(/[<>]/g, '').trim();
}

/** The lowercased address inside <...>, or the value when it looks like an address. */
export function fromAddress(from: string | undefined): string {
  if (!from) return '';
  const m = /<([^>]+)>/.exec(from);
  if (m?.[1]) return m[1].trim().toLowerCase();
  return /@/.test(from) ? from.trim().toLowerCase() : '';
}
