// parseQuestion (01 section 9, 20 section 9): normalization, typo correction, dates and other hints.
import { MAX_QUESTION_CHARS } from '@sieve/shared';
import type { QueryHints } from '@sieve/shared';
import type { SieveDb } from './db';
import { knownSenderWordsOf, senderCue } from './cues';
import { parseDates } from './dates';
import { isEnglishWord } from './dictionary';
import { lastReadyDb, peekRuntime } from './runtime';
import { cutGraphemes, emojiNames, withEmojiNames } from './text';
import { STOP_WORDS } from './tokenize';
import { correctQuery } from './typos';

/** `sender`: the sender the question names (20 section 9.4), a filter in search; `hints.from` stays the boost. */
export interface ParsedQuestion { normalized: string; corrected: string; hints: QueryHints; searchText?: string; sender?: string }

const SOURCE_WORDS: [NonNullable<QueryHints['source']>, string[]][] = [
  ['mail', ['email', 'emails', 'mail', 'inbox']],
  ['photos', ['photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'image', 'images', 'selfie', 'screenshot']],
  ['files', ['file', 'files', 'document', 'documents', 'doc', 'docs', 'pdf', 'note', 'notes', 'chat']],
];
const ROLES = ['landlord', 'doctor', 'dentist', 'bank', 'boss', 'manager', 'mom', 'dad', 'pharmacy', 'airline'];
const PREPOSITIONS = new Set('in on at by for to about after before since until during between from of with into over under near around last next this'.split(' '));
const MONTH_WORDS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i;

export function normalizeText(question: string): string {
  const s = question
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return cutGraphemes(s, MAX_QUESTION_CHARS);
}

function sourceHint(text: string): QueryHints['source'] {
  let best: { at: number; source: NonNullable<QueryHints['source']> } | null = null;
  for (const [source, words] of SOURCE_WORDS) {
    for (const w of words) {
      const m = new RegExp(`\\b${w}\\b`, 'i').exec(text);
      if (m && (!best || m.index < best.at)) best = { at: m.index, source };
    }
  }
  return best?.source;
}

function fromHint(text: string): string | undefined {
  const m = /\bfrom\s+([^?.!,;]+)/i.exec(text);
  if (m?.[1]) {
    const words: string[] = [];
    for (const w of m[1].split(/\s+/)) {
      const lw = w.toLowerCase();
      if (!w || STOP_WORDS.has(lw) || PREPOSITIONS.has(lw) || /\d/.test(w) || MONTH_WORDS.test(w)) break;
      words.push(w.replace(/[^\p{L}\p{N}'&-]/gu, ''));
      if (words.length >= 3) break;
    }
    const name = words.filter(Boolean).join(' ');
    if (name) return name;
  }
  const role = new RegExp(`\\bmy\\s+(${ROLES.join('|')})\\b`, 'i').exec(text);
  return role?.[1]?.toLowerCase();
}

function termHints(text: string, dateTexts: string[]): string[] {
  let s = text;
  for (const d of dateTexts) {
    const i = s.indexOf(d);
    if (i >= 0) s = s.slice(0, i) + ' '.repeat(d.length) + s.slice(i + d.length);
  }
  s = s.replace(/\$\s?\d[\d,]*(\.\d+)?/g, (x) => ' '.repeat(x.length)).replace(/\b\d{1,2}:\d{2}\b/g, (x) => ' '.repeat(x.length)).replace(/\d+(\.\d+)?%/g, (x) => ' '.repeat(x.length));
  const out: string[] = [];
  const push = (t: string) => {
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const m of s.matchAll(/"([^"]{2,60})"/g)) push((m[1] ?? '').trim());
  let first = true;
  for (const m of s.matchAll(/#?[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu)) {
    const raw = m[0].replace(/^#/, '');
    const isFirst = first;
    first = false;
    if (/\d/.test(raw) && raw.length >= 3) {
      if (/^\d+(st|nd|rd|th)$/i.test(raw)) continue;
      push(raw);
    } else if (!isFirst && /^\p{Lu}/u.test(raw) && raw.length >= 2 && !isEnglishWord(raw) && !STOP_WORDS.has(raw.toLowerCase())) {
      push(raw);
    }
  }
  return out.slice(0, 5);
}

/**
 * Synchronous, as in the contract. `opts.db` picks the vocabulary for typo correction (default: the db most
 * recently passed to ready()); `opts.flip` lists numeric dates the person flipped to the other order.
 */
export function parseQuestion(question: string, now: Date, locale: string, opts?: { db?: SieveDb; flip?: string[] }): ParsedQuestion {
  const normalized = normalizeText(question);
  const db = opts?.db ?? lastReadyDb();
  const rt = db ? peekRuntime(db) : undefined;
  const vocab = rt?.vocab ?? null;
  const { corrected } = correctQuery(normalized, vocab);
  const dates = parseDates(corrected, now, locale, opts?.flip);
  const hints: QueryHints = {};
  if (dates.after) hints.after = dates.after;
  if (dates.before) hints.before = dates.before;
  const source = sourceHint(corrected);
  if (source) hints.source = source;
  const from = fromHint(corrected);
  if (from) hints.from = from;
  const terms = termHints(corrected, dates.interpreted.map((i) => i.text));
  if (terms.length > 0) hints.terms = terms;
  if (dates.interpreted.length > 0) hints.interpreted = dates.interpreted;
  const out: ParsedQuestion = { normalized, corrected, hints };
  // photos have no sender: "photos from Hawaii" names a place
  const sender = source === 'photos' ? undefined : senderCue(corrected, rt ? knownSenderWordsOf(rt.meta) : undefined);
  if (sender) out.sender = sender;
  if (emojiNames(corrected).length > 0) out.searchText = withEmojiNames(corrected);
  return out;
}
