// One-line reasons for candidates (20 section 10.3): "{when}: {why}", plain code, at most 90 characters, no dashes.
import type { Candidate, IndexRecord, QueryHints } from '@sieve/shared';
import { REASON_MAX_CHARS } from './config';
import { cutAtWord, cutGraphemes, displayName } from './text';
import { processTerm, tokenize } from './tokenize';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AMOUNT = /\$\s?\d[\d,]*(\.\d{2})?/g;
const DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/gi;

export function relativeWhen(date: number, now: number): string {
  const days = Math.floor((now - date) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'last month';
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const d = new Date(date);
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

/** Content words of a question, raw form, with their processed term (stop words dropped). */
export function queryWordsOf(text: string): { word: string; term: string }[] {
  const out: { word: string; term: string }[] = [];
  for (const t of tokenize(text)) {
    const term = processTerm(t);
    if (!term || out.some((o) => o.term === term)) continue;
    out.push({ word: t.toLowerCase(), term });
  }
  return out;
}

function wordsIn(text: string, query: { word: string; term: string }[]): { word: string; at: number }[] {
  const found: { word: string; at: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)) {
    const term = processTerm(m[0]);
    if (!term) continue;
    const q = query.find((x) => x.term === term);
    if (q && !found.some((f) => f.word === q.word)) found.push({ word: q.word, at: m.index });
  }
  return found;
}

function near(text: string, at: number, re: RegExp): boolean {
  for (const m of text.matchAll(re)) if (Math.abs(m.index - at) <= 80) return true;
  return false;
}

function clean(s: string): string {
  return s.replace(/[—–]/g, ',').replace(/\s+/g, ' ').trim();
}

export interface ReasonInput {
  record: IndexRecord;
  candidate: Omit<Candidate, 'reason'> & { fromBoost?: boolean; termMatched?: string };
  queryWords: { word: string; term: string }[] | string[];
  hints: QueryHints;
  now: number;
}

export function reasonFor(input: ReasonInput): string {
  const { record, candidate, now } = input;
  const query = (input.queryWords as (string | { word: string; term: string })[]).map((q) => (typeof q === 'string' ? { word: q, term: processTerm(q) ?? q } : q));
  const when = relativeWhen(record.date, now);
  const chunk = candidate.chunk && record.text ? record.text.slice(candidate.chunk.start, candidate.chunk.end) : '';
  const scope = chunk || record.title;
  const inScope = wordsIn(scope, query);
  const inTitle = chunk ? wordsIn(record.title, query) : [];
  const amountWord = inScope.find((w) => near(scope, w.at, AMOUNT));
  const dateWord = inScope.find((w) => near(scope, w.at, DATE));
  let why: string;
  if (record.kind === 'photo') {
    why = `photo: ${cutGraphemes((record.caption ?? record.title).replace(/\.\s*$/, ''), 60)}`;
  } else if (candidate.fromBoost) {
    const shared = inScope.map((w) => w.word).slice(0, 2);
    why = `from ${displayName(record.from)}${shared.length > 0 ? `, mentions ${shared.join(' and ')}` : ''}`;
  } else if (candidate.termMatched) {
    why = `mentions ${candidate.termMatched}`;
  } else if (amountWord) {
    why = `mentions the ${amountWord.word} amount`;
  } else if (dateWord) {
    why = `mentions the ${dateWord.word} date`;
  } else if (inScope.length > 0 || inTitle.length > 0) {
    why = `mentions ${[...inScope, ...inTitle].map((w) => w.word).filter((w, i, a) => a.indexOf(w) === i).slice(0, 2).join(' and ')}`;
  } else if (candidate.matchedBy === 'gmail-search') {
    why = "found by Gmail's own search";
  } else {
    const first = clean((chunk || record.preview).split(/(?<=[.!?])\s/)[0] ?? '');
    why = `closest match: "${cutGraphemes(first, 50)}"`;
  }
  return cutAtWord(clean(`${when}: ${why}`), REASON_MAX_CHARS);
}
