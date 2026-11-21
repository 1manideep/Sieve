// Names and the asker's own words in outgoing text (11 section 10.2 step 6). Other people's names are masked
// consistently, the sender's too when the sender is a person; what the asker typed in the question is never masked,
// because the caller already knows it ("1manideep", "Kay", a repo name, an order id).
import type { IndexRecord, KnownEntity, PiiSpan } from '@sieve/shared';
import { isStopwordOrCalendarWord } from '../pii/merge';
import { GREETING_EXCLUDE, ORG_WORDS } from '../pii/validators/names';
import { senderName } from '../scan/scan';

const PERSONAL_DOMAIN = /^(?:gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|zoho|fastmail|hey|inbox|mail)\./i;
const NAME_WORD = /^\p{Lu}[\p{L}'’-]+$/u;

/** The sender's display name when it reads as a person ("Priya Shah <priya.shah@...>"), not a company ("Strava"). */
export function personSender(from: string | undefined): string | null {
  const name = senderName(from);
  if (!name || name.includes('@')) return null;
  const ws = name.split(/\s+/);
  if (ws.length > 3 || !ws.every((w) => NAME_WORD.test(w)) || ws.some((w) => ORG_WORDS.has(w) || GREETING_EXCLUDE.has(w))) return null;
  const addr = /<([^>]+)>/.exec(from ?? '')?.[1]?.toLowerCase() ?? '';
  const [local = '', domain = ''] = addr.split('@');
  const labels = domain.split('.').slice(0, -1);
  const low = ws.map((w) => w.toLowerCase());
  if (low.some((w) => labels.includes(w))) return null;                       // the domain is named after them: a company
  const localWords = local.split(/[._+-]+/);
  const named = low.some((w) => localWords.includes(w) || (w.length >= 3 && local.startsWith(w)));
  if (!PERSONAL_DOMAIN.test(domain) && !named) return null;
  return name;
}

/** The person sender's full name and each of its words, as known names to find in the outgoing text. */
export function senderEntities(record: Pick<IndexRecord, 'from'>): KnownEntity[] {
  const name = personSender(record.from);
  if (!name) return [];
  const words = name.split(/\s+/).filter((w) => w.length >= 3);
  return [name, ...(words.length > 1 ? words : [])].map((text) => ({ text, type: 'name' as const, by: 'validator' as const }));
}

/**
 * Lowercase sender words that are never an ID number (5.6 step 1): the item's own sender (display name words, the name
 * as one word, the address local part and the domain labels) plus `known`, the sender words of the whole index.
 */
export function senderWordsOf(record: Pick<IndexRecord, 'from'>, known?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>(known ?? []);
  const from = record.from ?? '';
  const name = senderName(from);
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (name && !name.includes('@')) {
    for (const w of words(name)) out.add(w);
    out.add(words(name).join(''));
  }
  const addr = /<([^>]+)>/.exec(from)?.[1] ?? (from.includes('@') ? from.trim() : '');
  const [local = '', domain = ''] = addr.toLowerCase().split('@');
  out.add(local.replace(/[^\p{L}\p{N}]/gu, ''));
  for (const label of domain.split('.').slice(0, -1)) out.add(label.replace(/[^\p{L}\p{N}]/gu, ''));
  out.delete('');
  return out;
}

/** "Good Dog sent you a booking": a company sender's own name is not a person's name, so it is not masked. */
export function notTheCompany(text: string, spans: readonly PiiSpan[], record: Pick<IndexRecord, 'from'>): PiiSpan[] {
  const name = senderName(record.from);
  if (!name || name.includes('@') || personSender(record.from)) return [...spans];
  const company = new Set(name.toLowerCase().split(/\s+/));
  return spans.filter((s) => !text.slice(s.start, s.end).toLowerCase().split(/\s+/).every((w) => company.has(w)));
}

const QUESTION_WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/**
 * Words the question writes as a name: a capital first letter, and not a function word or a calendar word. "Will I get
 * my refund?" or "is there a grace period" must not unmask Will Turner or Grace Park; the question of an outside
 * assistant is written by that assistant. A name typed in lowercase stays masked, which errs on the safe side.
 */
function nameWordsOf(question: string): Set<string> {
  const out = new Set<string>();
  for (const m of question.matchAll(QUESTION_WORD)) {
    const w = m[0].replace(/['’]s$/i, '');
    const first = w.charAt(0);
    if (first === first.toLowerCase() || isStopwordOrCalendarWord(w)) continue;
    out.add(w.toLowerCase());
  }
  return out;
}

function inQuestion(q: string, value: string): boolean {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (v.length < 2) return false;
  const body = v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/ /g, '\\s+');   // '-' needs no escape outside a class
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u').test(q);
}

/**
 * Drops the spans the asker typed: a whole value in the question stays as it is; in a name, the words the asker typed
 * stay and the rest is masked ("Kay [name]"). One-time codes are always masked.
 */
export function keepAskerWords(text: string, spans: readonly PiiSpan[], question: string | undefined): PiiSpan[] {
  if (!question?.trim()) return [...spans];
  const q = question.normalize('NFKC').toLowerCase();
  const nameWords = nameWordsOf(question.normalize('NFKC'));
  const out: PiiSpan[] = [];
  const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  const typed = (w: string) => nameWords.has(w.toLowerCase().replace(/['’]s$/, ''));
  for (const s of spans) {
    const value = text.slice(s.start, s.end);
    if (s.type === 'secret-code') {
      out.push(s);
      continue;
    }
    if (inQuestion(q, value)) continue;
    if (s.type !== 'name' || ![...value.matchAll(WORD)].some((m) => typed(m[0]))) {
      out.push(s);
      continue;
    }
    let cur: PiiSpan | null = null;
    for (const m of value.matchAll(WORD)) {
      const start = s.start + m.index;
      const end = start + m[0].length;
      if (typed(m[0])) {
        if (cur) out.push(cur);
        cur = null;
      } else if (cur) {
        cur.end = end;
      } else {
        cur = { ...s, start, end };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}
