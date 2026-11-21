// Answer-step output checks (11 section 10.3a, Nov 21, after the second tester's B-cases). Plain code on the answer.
// Before redaction (shapeAnswer): a yes or no question gets "Yes." or "No."; one fact per answer (no list, no two
// facts in two clauses); never the sender's address unless the question asks for it. After redaction (dropSubject,
// so the one-time-code check still sees "your verification code is"): never the item's subject line, 4 or more words
// of it in a row, unless the question asks for it. Organisation names stay; person names follow the mask rule.
import type { IndexRecord } from '@sieve/shared';
import { escapeRegExp } from '../text';

export type AnswerShape = { ok: true; text: string } | { ok: false; reason: 'one-fact' | 'not-yes-no' | 'empty' };

// ---------- the question ----------

const YES_NO_START = /^\W*(?:(?:hey|hi|ok|okay|so|and|please|quick question)[\s,:]+)*(?:did|does|do|is|are|was|were|has|have|had)\b/i;
const YES_NO_SAID = /\byes\s*(?:or|\/)\s*no\b/i;
const ASKS_THE_AI = /^\W*(?:(?:hey|hi|ok|okay|so|please)[\s,:]+)*(?:do|did|does)\s+you\b/i;
const WH = /\b(?:what|what's|whats|when|where|which|who|whom|whose|why|how)\b/i;

/**
 * "Did", "is", "was", "has", "do I have", or "yes or no" (11 section 10.3a). Not when it asks for a value inside
 * ("Did Ramki say when the release is?"), offers a choice ("Friday or Saturday?") or asks the AI to do something.
 */
export function isYesNoQuestion(question: string): boolean {
  const q = question.trim();
  if (YES_NO_SAID.test(q)) return true;
  if (!YES_NO_START.test(q) || ASKS_THE_AI.test(q)) return false;
  return !WH.test(q) && !/\bor\b/i.test(q);
}

const SUBJECT_Q = /\b(?:subject|subjects|subject line|title|titled|headline|heading)\b/i;
const ADDRESS_Q = /@|\b(?:e-?mail\s+address(?:es)?|email\s+(?:of|for)|(?:his|her|their|sender'?s?)\s+e-?mail|contact\s+e-?mail|reply-?to|(?:which|what)\s+(?:e-?mail\s+)?address)\b/i;

/** The question asks for the subject line itself. */
export function asksSubject(question: string): boolean {
  return SUBJECT_Q.test(question);
}

/** The question asks for an email address. */
export function asksAddress(question: string): boolean {
  return ADDRESS_Q.test(question);
}

// ---------- one fact ----------

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?';
const MONEY = /^(?:[$€£₹¥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|dollars|euros|pounds))$/i;
const DATE = new RegExp(`^(?:on\\s+)?(?:${DAY},?\\s+)?(?:${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:\\s+\\d{4})?|\\d{1,4}[/.-]\\d{1,2}(?:[/.-]\\d{1,4})?|${DAY})$`, 'i');
const TIME = /^(?:at\s+)?\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)$/i;
const CONNECT = new Set(['of', 'the', '&', 'and', 'de', 'for', 'von', 'van', 'da', 'la']);
const STATE = /^[A-Z]{2}$/;   // "Springfield, IL": a place, never an item of a list

type Kind = 'slot' | 'money' | 'date' | 'time' | 'number' | 'proper' | 'word';

function kindOf(raw: string): Kind | null {
  const t = raw.trim().replace(/^["'“‘(]+/, '').replace(/["'”’).,!?:;]+$/, '').trim();
  if (!t) return null;
  if (/^\[[^\]]+\]$/.test(t)) return 'slot';
  if (MONEY.test(t)) return 'money';
  if (DATE.test(t)) return 'date';
  if (TIME.test(t)) return 'time';
  if (/^#?\d[\d,.-]*$/.test(t)) return 'number';
  const ws = t.split(/\s+/);
  if (ws.length === 1 && STATE.test(t)) return null;
  if (ws.length <= 4 && !/\d/.test(t) && ws.every((w, i) => /^\p{Lu}/u.test(w) || (i > 0 && i < ws.length - 1 && CONNECT.has(w.toLowerCase())))) return 'proper';
  if (ws.length === 1 && /^\p{Ll}[\p{Ll}'’-]*$/u.test(t)) return 'word';
  return null;
}

const TOKENS = /\[[^\]]*\]|\S+/g;

/** The longest run of up to 4 tokens at one end of `piece` that is of `kind`. */
function endMatches(piece: string, kind: Kind, end: 'head' | 'tail'): boolean {
  const ts = piece.match(TOKENS) ?? [];
  for (let k = Math.min(4, ts.length); k >= 1; k -= 1) {
    const part = (end === 'tail' ? ts.slice(-k) : ts.slice(0, k)).join(' ');
    if (kindOf(part) === kind) return true;
  }
  return false;
}

const LIST_SEP = /\s*(?:,\s*(?:and|or|&)\s+|,\s+|;\s+|\s+(?:and|or|&)\s+)/i;

/** Three or more items of one kind in a row, separated by commas or "and" ("[name 1], [name 2] and [name 3]"). */
export function hasList(text: string): boolean {
  const pieces = text.split(LIST_SEP).filter((p) => p.trim());
  if (pieces.length < 3) return false;
  for (let s = 0; s + 1 < pieces.length; s += 1) {
    const next = pieces[s + 1]!;
    const nextIsLast = s + 1 === pieces.length - 1;
    const kinds = new Set<Kind>();
    const whole = kindOf(next);
    if (whole) kinds.add(whole);
    if (nextIsLast) for (const k of ['slot', 'money', 'date', 'time', 'number', 'proper', 'word'] as const) if (endMatches(next, k, 'head')) kinds.add(k);
    for (const kind of kinds) {
      let n = endMatches(pieces[s]!, kind, 'tail') ? 1 : 0;
      let j = s + 1;
      while (j < pieces.length - 1 && kindOf(pieces[j]!) === kind) {
        n += 1;
        j += 1;
      }
      if (j === pieces.length - 1 && endMatches(pieces[j]!, kind, 'head')) n += 1;
      if (n >= 3) return true;
    }
  }
  return false;
}

/** "1) ... 2) ..." or "1. ... 2. ...". */
export function hasNumberedItems(text: string): boolean {
  const ns = [...text.matchAll(/(?:^|[\s:;,(])\(?(\d{1,2})[.)](?=\s)/g)].map((m) => Number(m[1]));
  const one = ns.indexOf(1);
  return one >= 0 && ns.slice(one + 1).includes(2);
}

// No 'i' flag: with it, \p{Lu} would match lowercase letters too. Joining words are lowercase mid-sentence anyway.
const CLAUSE_SEP = new RegExp(
  [
    ';\\s*',
    ',\\s*(?:and|but|while|whereas|plus|also)\\s+',
    '\\s+(?:and|but|plus|also)\\s+(?=(?:your|my|the|it|its|it\'s|you|you\'re|he|she|they|we|I|this|that|there|his|her|their)\\b)',
    '[.!?]\\s+(?=[\\p{Lu}\\d])',
  ].join('|'),
  'u',
);
const FACT = new RegExp(
  [
    '\\[[^\\]]+\\]',                                            // a masked value
    '[$€£₹¥]\\s?\\d',
    '\\d',
    `\\b${MONTH}\\s+\\d`,
    `\\b${DAY}\\b`,
    '[\\w.+-]+@[\\w-]+\\.\\w',
    '["“][^"”]{3,}["”]',
  ].join('|'),
  'iu',
);

/** A clause states a fact: a number, an amount, a date, a masked value, an address, a quote, or a name inside it. */
function statesFact(clause: string): boolean {
  if (FACT.test(clause)) return true;
  const ws = clause.trim().split(/\s+/).slice(1);
  return ws.some((w) => /^\p{Lu}[\p{L}\p{N}&'’.-]*$/u.test(w.replace(/[.,!?;:)"”’]+$/, '')) && w.toLowerCase() !== 'i');
}

/** Two independent clauses, each with its own fact ("Your AWS account ID is [id number], and your free plan ended on October 26"). */
export function hasTwoFactClauses(text: string): boolean {
  const clauses = text.split(CLAUSE_SEP).filter((c) => c && c.trim().length > 0);
  return clauses.filter(statesFact).length >= 2;
}

/** One fact per answer (11 section 10.3a): a list, numbered items or two fact clauses is more than one. */
export function packsSeveralFacts(text: string): boolean {
  return hasNumberedItems(text) || hasList(text) || hasTwoFactClauses(text);
}

// ---------- the subject line and the sender's address ----------

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
const LEAD_IN = /(?:,?\s*(?:with|has|had|having|under|about)?\s*(?:the|a|its)?\s*(?:subject(?:\s+line)?|title|heading|headline)\s*(?:of|is|was|reads|reading)?\s*:?|,?\s*(?:titled|entitled|called|named|headed|saying)\s*:?)\s*["'“‘]?\s*$/i;

/** Removes every run of 4 or more words in a row from the subject line, with its quotes and "with the subject". */
export function stripSubject(text: string, title: string | undefined): string {
  if (!title) return text;
  const t = title.replace(/^(?:\s*(?:re|fwd?|fw|aw|wg)\s*:\s*)+/i, '');
  const tw = [...t.matchAll(WORD)].map((m) => m[0].toLowerCase());
  if (tw.length < 4) return text;
  const aw = [...text.matchAll(WORD)].map((m) => ({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length }));
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < aw.length; ) {
    let best = 0;
    for (let j = 0; j < tw.length; j += 1) {
      let k = 0;
      while (i + k < aw.length && j + k < tw.length && aw[i + k]!.w === tw[j + k]) k += 1;
      best = Math.max(best, k);
    }
    if (best >= 4) {
      runs.push({ start: aw[i]!.start, end: aw[i + best - 1]!.end });
      i += best;
    } else {
      i += 1;
    }
  }
  if (runs.length === 0) return text;
  let out = text;
  for (const r of runs.reverse()) {
    let before = out.slice(0, r.start);
    let after = out.slice(r.end);
    before = before.replace(LEAD_IN, '');
    after = after.replace(/^\s*["'”’]/, '');
    // "Your Zillow verification code is [code]." becomes "It is [code]."
    if (!/[\p{L}\p{N}]/u.test(before)) {
      after = after.replace(/^[\s,;:]*(?:(?:and|but|so)\s+)?/i, '');
      if (/^\p{Ll}/u.test(after)) after = `it ${after}`;
    }
    out = `${before.trimEnd()} ${after.trimStart()}`;
  }
  return tidy(out);
}

function addressOf(from: string | undefined): string | null {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(from ?? '') ?? /([^\s<>"]+@[^\s<>"]+)/.exec(from ?? '');
  return m?.[1] ? m[1].toLowerCase() : null;
}

function displayNameOf(from: string | undefined): string {
  const lt = (from ?? '').indexOf('<');
  return lt < 0 ? '' : (from ?? '').slice(0, lt).trim().replace(/^"(.*)"$/, '$1').trim();
}

/** Removes the sender's address; an organisation's name takes its place when the answer does not already name it. */
export function stripSenderAddress(text: string, from: string | undefined, isPerson: (from: string | undefined) => boolean): string {
  const addr = addressOf(from);
  if (!addr) return text;
  const re = new RegExp(`(\\s+(?:from|by|at|via))?\\s*[<(\\[]?${escapeRegExp(addr)}[>)\\]]?`, 'gi');
  if (!re.test(text)) return text;
  const name = displayNameOf(from);
  const rest = text.replace(re, ' ').toLowerCase();
  const useName = !!name && !name.includes('@') && !isPerson(from) && !rest.includes(name.toLowerCase());
  const out = text.replace(re, (_m, prep: string | undefined) => (useName ? `${prep ?? ''} ${name}` : ''));
  return tidy(out);
}

function tidy(s: string): string {
  let out = s
    .replace(/["“”'‘’]\s*["“”'‘’]/g, ' ')
    .replace(/\(\s*\)|\[\s*\]|<\s*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .replace(/^[\s,;:.-]+/, '')
    .replace(/^(?:and|but|or|so|also)\s+/i, '')
    .replace(/\s+(?:with|about|from|by|at|via|titled|called|named|the|a|an)\s*([.!?])?$/i, '$1')
    .trim();
  if (out && /^\p{Ll}/u.test(out)) out = out[0]!.toUpperCase() + out.slice(1);
  return out;
}

const FILLER = new Set(
  ('a an the your you my it its is was were are be been has have had this that these those with of to in on for from by at and or but ' +
    'email emails message messages mail item items subject line title titled called named sent says said say latest last newest recent there here one')
    .split(' '),
);

/** Something besides filler words and masked values is left ("Your latest email." and "[name]." are nothing). */
export function hasContent(text: string): boolean {
  return [...text.replace(/\[[^\]]*\]/g, ' ').matchAll(WORD)].some((m) => !FILLER.has(m[0].toLowerCase()));
}

// ---------- all together ----------

function ended(out: string, before: string): string {
  return out !== before && !/[.!?]$/.test(out) ? `${out}.` : out;
}

/**
 * The answer as it may leave, before redaction (11 section 10.3a), or why it may not: `one-fact` (the pipeline makes
 * the outcome unsupported at the answer level), `not-yes-no` (a yes or no question the model did not answer with yes
 * or no), or `empty` (nothing left once the sender's address was taken out).
 */
export function shapeAnswer(
  answer: string,
  record: Pick<IndexRecord, 'title' | 'from'>,
  question: string | undefined,
  isPerson: (from: string | undefined) => boolean,
): AnswerShape {
  const text = answer.trim();
  if (question && isYesNoQuestion(question)) {
    const first = /^\W*(yes|yeah|yep|no|nope)\b/i.exec(text);
    if (!first) return { ok: false, reason: 'not-yes-no' };
    return { ok: true, text: /^n/i.test(first[1]!) ? 'No.' : 'Yes.' };
  }
  if (packsSeveralFacts(text)) return { ok: false, reason: 'one-fact' };
  const out = !question || !asksAddress(question) ? stripSenderAddress(text, record.from, isPerson) : text;
  if (!hasContent(out)) return { ok: false, reason: 'empty' };
  return { ok: true, text: ended(out, text) };
}

/** After redaction: the answer without the item's subject line (unless asked for), or `empty` when nothing is left. */
export function dropSubject(text: string, record: Pick<IndexRecord, 'title'>, question: string | undefined): AnswerShape {
  if (question && (asksSubject(question) || isYesNoQuestion(question))) return { ok: true, text };
  const out = stripSubject(text, record.title);
  if (out === text) return { ok: true, text };
  if (!hasContent(out)) return { ok: false, reason: 'empty' };
  return { ok: true, text: ended(out, text) };
}
