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

const DETERMINER = new Set(['a', 'an', 'the', 'this', 'that', 'your', 'my', 'our', 'their', 'his', 'her', 'its']);
const NOT_A_HEAD = new Set(
  'of in on at for with from to by via and or but is are was were be has have had will would can could may sent said says'.split(' '),
);

/**
 * "A Python, Django and GCP developer role": the items only describe one thing named after the last of them (a job
 * title, a product, the skills of one role), so they are one fact. The first item follows a determiner, and a singular
 * word follows the last one. After a determiner other than "a" or "an", that word must be lowercase when the items are
 * names, so a run of full names stays a list.
 */
function describesOneThing(first: string, last: string, kind: Kind): boolean {
  const before = first.match(TOKENS) ?? [];
  let led = '';
  for (let k = 1; k < before.length && k <= 4 && !led; k += 1) {
    const d = before[before.length - k - 1]!.toLowerCase();
    if (DETERMINER.has(d) && kindOf(before.slice(-k).join(' ')) === kind) led = d;
  }
  if (!led) return false;
  const after = last.match(TOKENS) ?? [];
  for (let k = 1; k < after.length && k <= 4; k += 1) {
    if (kindOf(after.slice(0, k).join(' ')) !== kind) continue;
    const head = after[k]!.replace(/[.,!?;:)"”’]+$/, '');
    if (!/^\p{L}/u.test(head) || NOT_A_HEAD.has(head.toLowerCase())) return false;
    if (/[^s]s$/i.test(head) && !/(?:us|is)$/i.test(head)) return false;   // a plural names several things
    return led === 'a' || led === 'an' || kind !== 'proper' || /^\p{Ll}/u.test(head);
  }
  return false;
}

/**
 * Three or more items of one kind in a row, separated by commas or "and" ("[name 1], [name 2] and [name 3]"). Not when
 * they only describe one thing (describesOneThing).
 */
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
      // counted from where the run starts, so the tail of a run that describes one thing is not a list either
      if (s > 0 && kindOf(pieces[s]!) === kind && endMatches(pieces[s - 1]!, kind, 'tail')) continue;
      let n = endMatches(pieces[s]!, kind, 'tail') ? 1 : 0;
      let j = s + 1;
      while (j < pieces.length - 1 && kindOf(pieces[j]!) === kind) {
        n += 1;
        j += 1;
      }
      const headed = j === pieces.length - 1 && endMatches(pieces[j]!, kind, 'head');
      if (headed) n += 1;
      if (n >= 3 && !(headed && describesOneThing(pieces[s]!, pieces[j]!, kind))) return true;
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

/**
 * The first clause that states a fact, as a sentence of its own: what is shared of an answer that packed two. The
 * model leads with what was asked and then adds to it ("Your order was cancelled, and $48.00 will be refunded").
 */
export function firstFactClause(text: string): string | null {
  const first = text.split(CLAUSE_SEP).map((c) => (c ?? '').trim()).find((c) => c && statesFact(c));
  if (!first) return null;
  const clause = first.replace(/[,;:\s]+$/, '');
  return /[.!?]$/.test(clause) ? clause : `${clause}.`;
}

/** One fact per answer (11 section 10.3a): a list, numbered items or two fact clauses is more than one. */
export function packsSeveralFacts(text: string): boolean {
  return hasNumberedItems(text) || hasList(text) || hasTwoFactClauses(text);
}

// ---------- output structure ----------

const SLOT = /\[[^[\]{}"]*\]/g;   // a masked value or a "[...]" cut is text, not structure
const STRUCTURE = /```|\}\s*\]|\]\s*\}|\{\s*"|"\s*\}|"\s*:\s*["{[]/;

/**
 * JSON or Markdown structure in an answer (Nov 21: "It today, November 21st.}]."): "}]", '{"', '"}', a key with its
 * value, a code fence, or a bracket, brace, backtick, comma or unpaired quote at either end. Such an answer is bad
 * output, never a sentence to share.
 */
export function leaksStructure(answer: string): boolean {
  const t = answer.replace(SLOT, 'x').trim();
  if (STRUCTURE.test(t)) return true;
  const core = t.replace(/[.!?]+$/, '');
  if (/^[[\]{}`,]|[[\]{}`,]$/.test(core)) return true;
  return /^"|"$/.test(core) && (core.match(/"/g) ?? []).length % 2 === 1;
}

// ---------- the subject line and the sender's address ----------

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
const LEAD_IN = /(?:,?\s*(?:with|has|had|having|under|about)?\s*(?:the|a|its)?\s*(?:subject(?:\s+line)?|title|heading|headline)\s*(?:of|is|was|reads|reading)?\s*:?|,?\s*(?:titled|entitled|called|named|headed|saying)\s*:?)\s*["'“‘]?\s*$/i;

/**
 * Removes the subject line where the answer cites it: a run of 4 or more of its words in a row that stands in quotes
 * or after "with the subject", "titled" and the like. The same words used as the answer's own statement stay: the
 * fact a person asks for is often in the subject ("Your order has shipped", a role, a place, a booking number), and
 * taking those words out left "It departs from at 06:40 AM." or nothing at all (Nov 21, 2026 live test).
 */
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
      const start = aw[i]!.start;
      const end = aw[i + best - 1]!.end;
      const before = text.slice(0, start);
      const cited = LEAD_IN.test(before) || (/["'“‘]\s*$/.test(before) && /^\s*["'”’]/.test(text.slice(end)));
      if (cited) runs.push({ start, end });
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
  // A list or numbered items is refused whole. Two clauses that each state a fact are cut to the first: one fact is
  // still all that is shared, and an answer is not lost because the model added a second clause (Nov 21, 2026: "the
  // status of order ..." ended as unsupported).
  if (hasNumberedItems(text) || hasList(text)) return { ok: false, reason: 'one-fact' };
  let one = text;
  if (hasTwoFactClauses(text)) {
    const first = firstFactClause(text);
    if (!first || packsSeveralFacts(first)) return { ok: false, reason: 'one-fact' };
    one = first;
  }
  const out = !question || !asksAddress(question) ? stripSenderAddress(one, record.from, isPerson) : one;
  if (!hasContent(out)) return { ok: false, reason: 'empty' };
  return { ok: true, text: ended(out, one) };
}

/** After redaction: the answer without the item's subject line (unless asked for), or `empty` when nothing is left. */
export function dropSubject(text: string, record: Pick<IndexRecord, 'title'>, question: string | undefined): AnswerShape {
  if (question && (asksSubject(question) || isYesNoQuestion(question))) return { ok: true, text };
  const out = stripSubject(text, record.title);
  // an answer that was only the cited subject is kept as it is: it is still what the item says
  if (out === text || !hasContent(out)) return { ok: true, text };
  return { ok: true, text: ended(out, text) };
}
