// Shared text helpers for prompts and excerpts (10 section 10.1). Plain code, no model.

export interface Range { start: number; end: number }

const SENTENCE_RE = /[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g;

/** Sentence ranges in `text`, trimmed, with offsets into `text`. */
export function sentences(text: string): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(SENTENCE_RE)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = (m.index ?? 0) + lead;
    out.push({ start, end: start + trimmed.length });
  }
  return out;
}

export const STOPWORDS: ReadonlySet<string> = new Set(
  ('a an the and or but of to in on at by for with from is are was were be been it its this that these those you your yours ' +
    'i me my we our they them their he she his her as if so not no yes do does did can could will would should may might must ' +
    'has have had about into than then there here what when where which who whom how why also just only very more most some any ' +
    'all each per via').split(' '),
);

/** Lowercase content words: letters (with ' and -), longer than 2, not stop words. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Strips one trailing ing, ed, es or s when the word stays at least 4 letters long. */
export function stem(word: string): string {
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

export function stems(text: string): Set<string> {
  return new Set(contentWords(text).map(stem));
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Cuts at a word boundary and adds "..." so the result is at most `max` characters. */
export function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const room = Math.max(0, max - 3);
  let cut = s.slice(0, room);
  const space = cut.lastIndexOf(' ');
  if (space > room * 0.5) cut = cut.slice(0, space);
  return `${cut.trimEnd()}...`;
}

/** Item content sits between <<< and >>> lines; these sequences inside it are broken up (10 section 10.1). */
export function escapeDelimiters(s: string): string {
  return s.replaceAll('<<<', '< < <').replaceAll('>>>', '> > >');
}

/** A single-line field for a prompt: whitespace collapsed, delimiters broken, cut at a word boundary. */
export function promptField(s: string | undefined, max: number): string {
  return cutAtWord(escapeDelimiters(collapseWhitespace(s ?? '')), max);
}

/** Local YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Cleans a model sentence (answers, captions): whitespace collapsed, wrapping quotes and a leading "Answer:" removed,
 * and when longer than `max`, cut at the last sentence end before the limit (else at a word boundary, adding ".").
 */
export function cleanModelSentence(value: string, max: number): string {
  let s = collapseWhitespace(value);
  for (let i = 0; i < 2; i += 1) {
    const before = s;
    s = s.replace(/^answer\s*:\s*/i, '');
    if (s.length >= 2) {
      const first = s[0];
      const last = s[s.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '“' && last === '”')) {
        s = s.slice(1, -1).trim();
      }
    }
    if (s === before) break;
  }
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  let end = -1;
  for (const m of head.matchAll(/[.!?]["')\]]*(?=\s|$)/g)) end = (m.index ?? 0) + m[0].length;
  if (end > 0) return head.slice(0, end).trim();
  const space = head.lastIndexOf(' ');
  const cut = (space > 0 ? head.slice(0, space) : head.slice(0, max - 1)).replace(/[\s,;:]+$/, '');
  return `${cut.slice(0, max - 1)}.`;
}
