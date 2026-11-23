// selectAndAnswer (10 section 10.3): the one model call at question time. Nano reads passages (the best chunk of each
// candidate), picks the item and writes a one-sentence answer, streamed. The excerpt is then chosen by plain code from
// the record text, so it is verbatim by construction (decision A7).
import { NANO_PROMPT_BUDGET } from '@sieve/shared';
import type { DataClass, IndexRecord, ItemKind, QueryHints, TraceStep } from '@sieve/shared';
import { estimatePromptTokens } from '../budget';
import {
  ANSWER_MAX_CHARS,
  EXCERPT_MAX_CHARS,
  PASSAGE_CONTEXT_CHARS,
  PASSAGE_MAX_CHARS,
  PASSAGE_SNAP_CHARS,
  PASSAGE_WINDOW_CHARS,
  SELECT_MAX_PASSAGES,
  SELECT_TARGET_TOKENS,
  TIMING,
} from '../config';
import { extractFacts, normFact, normalizedFacts } from '../facts';
import { partialJsonString } from '../json';
import { RESHAPE_REMINDER, RETRY_REMINDER, SELECT_CLOUD_SCHEMA, SELECT_EXAMPLE, SELECT_SCHEMA, SELECT_SYSTEM, YES_NO_REMINDER, madeUpReminder } from '../prompts';
import { runModel } from '../runModel';
import { cleanModelSentence, collapseWhitespace, escapeDelimiters, localDay, promptField, sentences, stems, type Range } from '../text';
import { codeTrace } from '../trace';
import { isYesNoQuestion, leaksStructure, shapeAnswer } from '../../privacy/steps/answerShape';
import { copiesTooMuch } from '../../privacy/steps/invariants';
import type { OwnCloudPolicy, RunModelResult } from '../types';

export { SELECT_CLOUD_SCHEMA, SELECT_SCHEMA, SELECT_SYSTEM } from '../prompts';

export type PassageRange = Range;                       // offsets into recordBody(record)
export interface Passage {
  record: IndexRecord;
  range: PassageRange;
  text: string;                                         // exactly as it appears in the prompt
}
export interface SelectValue {
  recordId: string | null;
  answer: string;
  excerpt: string;
  excerptStart?: number;
  excerptEnd?: number;
  passage?: PassageRange;
  unsupported?: string[];
}
export interface SelectOptions {
  passages?: Record<string, PassageRange>;
  signal?: AbortSignal;
  ownCloud?: OwnCloudPolicy;
  onAnswerText?: (soFar: string) => void;
  hints?: QueryHints;
  today?: number;
  latest?: boolean;                                     // the question asks for the newest item; passages come newest first
}

type PromptOpts = { hints?: QueryHints; today?: number; latest?: boolean };

const FIELD_CHARS = 140;
/** A bare "Yes." or "No." (11 section 10.3a): its excerpt is found from the question's words instead. */
export function excerptBasis(answer: string, question: string): string {
  return /^\W*(?:yes|no)\W*$/i.test(answer) ? question : answer;
}

/** 70 R-MDL-08: an answer that is really "not found" counts as no item. */
const REFUSAL_RE = /^(not (in|found)|no (information|answer|mention)|(i|sorry,? i) (can't|cannot|don't|couldn't))\b/i;

/** photo: caption ?? ''; else text ?? preview. */
export function recordBody(r: IndexRecord): string {
  if (r.kind === 'photo') return r.caption ?? '';
  return r.text ?? r.preview ?? '';
}

function clampRange(range: PassageRange, length: number): PassageRange {
  const start = Math.max(0, Math.min(length, Math.floor(range.start)));
  const end = Math.max(start, Math.min(length, Math.floor(range.end)));
  return { start, end };
}

const MONEY_ASKED = /\b(?:how much|charged?|charges?|costs?|price[ds]?|paid|pay|payment|amount|total|fees?|refund(?:ed)?|bill(?:ed)?|balance|rent|owed?|worth|salary)\b/i;
const DATE_ASKED = /\b(?:when|date|what (?:day|time)|which day|how long|deadline|due|expir\w*|runs? out|until|check-?in|check-?out)\b/i;
const MONEY_HELD = /(?:[$€£₹]|\b(?:USD|EUR|GBP|INR|Rs\.?)\s?)\s?\d|\b\d[\d,]*\.\d{2}\b/;
const DATE_HELD =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b|\b\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2})\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:today|tonight|tomorrow|yesterday)\b|\b\d+\s+(?:days?|weeks?|months?|hours?)\b/i;

/**
 * The kind of fact a question asks for, as a test on text: an amount of money ("how much", "charged"), or a date or
 * time ("when", "expires", "check-in"). Null when the question asks for neither. The passage of an item should hold a
 * fact of that kind: a receipt's matched chunk was its header, the price line sat just past it, and the model
 * answered with an amount from another item (6 of 6 on the on-device model, Nov 21, 2026).
 */
// A question about what an item says ("what did the email about my membership payment say") names its subject with the
// same words ("payment", "rent", "due"): there only an outright "how much" or "when" asks for an amount or a date.
// Before, a right answer with no number in it ("your payment failed") was withheld (Nov 22, 2026).
const SAYS_ASKED = /\b(?:say|says|said|about|regarding|mention(?:s|ed)?)\b/i;
const MONEY_SURE = /\bhow much\b/i;
const DATE_SURE = /\b(?:when|what (?:day|date|time)|which day|how long)\b/i;

function kindsAsked(question: string): { money: boolean; date: boolean } {
  const says = SAYS_ASKED.test(question);
  return { money: (says ? MONEY_SURE : MONEY_ASKED).test(question), date: (says ? DATE_SURE : DATE_ASKED).test(question) };
}

export function answerKind(question: string): RegExp | null {
  const { money, date } = kindsAsked(question);
  if (money && date) return new RegExp(`${MONEY_HELD.source}|${DATE_HELD.source}`, 'i');
  return money ? MONEY_HELD : date ? DATE_HELD : null;
}

const DATE_ALL = new RegExp(DATE_HELD.source, 'gi');
const NO_CHARGE = /\b(?:free|no charge|not charged|nothing|none|waived|zero)\b/i;

/**
 * Does an answer hold the kind of fact the question asked for? For a date, any number counts, or a weekday or
 * "tomorrow". For an amount: a sum of money, "free" or "nothing", or a number that is not a date or a time. A date
 * alone does not answer "how much": a receipt question was answered with the day of the receipt (Nov 22, 2026).
 * True for a question that asks for neither.
 */
export function answersKind(question: string, answer: string): boolean {
  const { money, date } = kindsAsked(question);
  if (!money && !date) return true;
  if (date && (/\d/.test(answer) || DATE_HELD.test(answer))) return true;
  if (!money) return false;
  if (MONEY_HELD.test(answer) || NO_CHARGE.test(answer)) return true;
  return /\d/.test(answer.replace(DATE_ALL, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' '));
}

const LONG_DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
const DAY_MS = 86_400_000;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMERIC_DAY = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](?:\d{4}|\d{2}))?\b|\b\d{4}-(\d{2})-(\d{2})\b/g;
const RELATIVE_DAY =
  /\b(?:today|tonight|tomorrow|yesterday|(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:this|next|last)\s+(?:week|month)|in\s+(?:a|an|one|two|three|\d+)\s+(?:days?|weeks?))\b/i;

/**
 * The dates and amounts of money in an answer that nothing the model was given holds: not the item's text or subject,
 * not the day the item is dated, not the question, not today's date. A day the item writes in digits ("11/24") counts
 * as held, read either way round; so does a day up to two weeks after the item's date when the item says "tomorrow",
 * "next week" or a weekday, because the model may work that day out. Other numbers are left to the excerpt's own check.
 */
export function madeUpFacts(answer: string, record: IndexRecord, question: string, today: number): string[] {
  const body = recordBody(record);
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', LONG_DAY);
  const known = new Set<string>();
  for (const given of [body, record.title, record.from ?? '', question, day(record.date), day(today)]) {
    for (const f of normalizedFacts(given)) known.add(f);
  }
  const hold = (month: number, d: number) => {
    if (month >= 1 && month <= 12 && d >= 1 && d <= 31) known.add(`date:${MONTH_KEYS[month - 1]}-${d}`);
  };
  for (const m of `${body} ${record.title}`.matchAll(NUMERIC_DAY)) {
    if (m[3]) hold(Number(m[3]), Number(m[4]));
    else {
      hold(Number(m[1]), Number(m[2]));
      hold(Number(m[2]), Number(m[1]));
    }
  }
  if (RELATIVE_DAY.test(body)) {
    for (let i = -1; i <= 14; i++) {
      const d = new Date(record.date + i * DAY_MS);
      hold(d.getMonth() + 1, d.getDate());
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of extractFacts(answer)) {
    const n = normFact(raw);
    if (!(n.startsWith('date:') || raw.trim().startsWith('$')) || known.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(raw.trim());
  }
  return out;
}

const EXAMPLE_FACTS = normalizedFacts(SELECT_EXAMPLE);

/**
 * A fact of the prompt's own example answer in an answer whose item does not hold it: the model repeated its
 * instructions. Such an answer is never shared (it had its one retry in selectAndAnswer).
 */
export function repeatsExample(answer: string, record: IndexRecord, question: string, today: number): string | undefined {
  return madeUpFacts(answer, record, question, today).find((f) => EXAMPLE_FACTS.has(normFact(f)));
}

/** What the one retry says when the first answer lacked the kind of fact asked for. */
export function kindReminder(question: string): string {
  const { money, date } = kindsAsked(question);
  const wants = money && date ? 'an amount of money or a date' : money ? 'an amount of money' : 'a date or a time';
  return `Your last answer cannot be shared: the question asks for ${wants}, and the answer gave none. Reply again with JSON only. "answer" is one short sentence that gives it as the passage states it. If the passage does not state it, "item" is "none".`;
}

/** A sentence that holds the kind of fact asked for counts like this many question words. */
const KIND_BONUS = 2;

/**
 * The run of consecutive sentences (at most maxChars) holding the most question stems; ties go to the earliest.
 * `wants`: a sentence it matches (answerKind) counts for more, and when the text holds one, the run chosen holds one:
 * a receipt's long footer named the company in every sentence and outscored the one line with the price, so a "how
 * much" question was answered from a passage with no amount in it (twice on real mail, Nov 22, 2026).
 */
export function bestWindow(text: string, question: string, maxChars: number, wants?: RegExp | null): PassageRange {
  if (text.length <= maxChars) return { start: 0, end: text.length };
  const ss = sentences(text);
  if (ss.length === 0) return { start: 0, end: maxChars };
  const q = stems(question);
  const score = ss.map((s) => {
    const sentence = text.slice(s.start, s.end);
    const sentenceStems = stems(sentence);
    let n = wants?.test(sentence) ? KIND_BONUS : 0;
    for (const w of q) if (sentenceStems.has(w)) n += 1;
    return n;
  });
  type Run = { start: number; end: number; total: number };
  let best: Run | null = null;
  let bestOfKind: Run | null = null;   // the best run that holds a fact of the kind asked for
  const offer = (candidate: Run) => {
    if (!best || candidate.total > best.total) best = candidate;
    if (wants && (!bestOfKind || candidate.total > bestOfKind.total) && wants.test(text.slice(candidate.start, candidate.end))) bestOfKind = candidate;
  };
  for (let i = 0; i < ss.length; i += 1) {
    if (ss[i].end - ss[i].start > maxChars) {
      offer({ start: ss[i].start, end: ss[i].start + maxChars, total: score[i] });
      continue;
    }
    let total = 0;
    let j = i;
    while (j < ss.length && ss[j].end - ss[i].start <= maxChars) {
      total += score[j];
      j += 1;
    }
    offer({ start: ss[i].start, end: ss[j - 1].end, total });
  }
  const chosen = (bestOfKind ?? best) as Run | null;
  return chosen ? { start: chosen.start, end: chosen.end } : { start: 0, end: maxChars };
}

/** Moves the start back and the end forward to sentence boundaries, at most PASSAGE_SNAP_CHARS each. */
export function snapToSentences(body: string, range: PassageRange, ss: Range[] = sentences(body)): PassageRange {
  let { start, end } = range;
  const first = ss.find((s) => s.end > start);
  if (first && first.start <= start && start - first.start <= PASSAGE_SNAP_CHARS) start = first.start;
  else if (first && first.start > start && first.start - start <= PASSAGE_SNAP_CHARS && first.start < end) start = first.start;
  const last = [...ss].reverse().find((s) => s.start < end);
  if (last && last.end >= end && last.end - end <= PASSAGE_SNAP_CHARS) end = last.end;
  return { start, end: Math.max(start, end) };
}

/** Cuts a range at a sentence boundary so it is at most `max` characters long (or hard-cuts a single long sentence). */
function capAtSentence(body: string, range: PassageRange, max: number, ss: Range[]): PassageRange {
  if (range.end - range.start <= max) return range;
  let end = range.start;
  for (const s of ss) {
    if (s.start < range.start) continue;
    if (s.end - range.start > max) break;
    end = s.end;
  }
  return { start: range.start, end: end > range.start ? end : range.start + max };
}

function passageText(body: string, range: PassageRange, photo: boolean): string {
  const core = escapeDelimiters(body.slice(range.start, range.end).trim());
  if (photo) return core;
  const before = body.slice(0, range.start).trim().length > 0;
  const after = body.slice(range.end).trim().length > 0;
  return `${before ? '[...] ' : ''}${core}${after ? ' [...]' : ''}`;
}

export function recordDay(r: IndexRecord): string {
  return localDay(r.kind === 'photo' ? (r.photo?.takenAt ?? r.date) : r.date);
}

function passageBlock(p: Passage, n: number): string {
  const r = p.record;
  const lines = [`P${n}`, `Kind: ${r.kind}`];
  if (r.from && r.kind !== 'photo') lines.push(`From: ${promptField(r.from, FIELD_CHARS)}`);
  lines.push(`Date: ${recordDay(r)}`, `Title: ${promptField(r.title, FIELD_CHARS)}`);
  lines.push(r.kind === 'photo' ? 'Description:' : 'Passage:', '<<<', p.text, '>>>');
  return lines.join('\n');
}

function hintLines(hints: QueryHints | undefined): string[] {
  if (!hints) return [];
  const out: string[] = [];
  if (hints.after && hints.before) out.push(`The person means items dated from ${hints.after} to ${hints.before}.`);
  else if (hints.after) out.push(`The person means items dated from ${hints.after}.`);
  else if (hints.before) out.push(`The person means items dated up to ${hints.before}.`);
  const terms = (hints.terms ?? []).map((t) => promptField(t, 60)).filter(Boolean);
  if (terms.length) out.push(`Exact terms to look for: ${terms.join(', ')}.`);
  return out;
}

/** The user message for the select call (10 section 10.3). */
export function selectPrompt(question: string, passages: Passage[], opts?: PromptOpts): string {
  const head = [`Today is ${localDay(opts?.today ?? Date.now())}.`, `Question: ${promptField(question, 600)}`, ...hintLines(opts?.hints)];
  if (opts?.latest) head.push('The person wants the newest item that answers the question. The passages are listed newest first.');
  // 11 section 10.3a: the share-time build keeps only the first word of the answer to a yes or no question
  if (isYesNoQuestion(question)) head.push('This is a yes or no question: "answer" is exactly "Yes." or "No.".');
  return [head.join('\n'), ...passages.map((p, i) => passageBlock(p, i + 1))].join('\n\n');
}

function estimate(question: string, passages: Passage[], opts?: PromptOpts): number {
  return estimatePromptTokens({ system: SELECT_SYSTEM, texts: [selectPrompt(question, passages, opts)], images: 0, schema: SELECT_SCHEMA });
}

/** Passages for at most SELECT_MAX_PASSAGES records, in rank order, within the prompt budget (10 section 10.3). */
export function fitPassages(
  question: string,
  records: IndexRecord[],
  ranges: Record<string, PassageRange>,
  opts?: PromptOpts,
): Passage[] {
  const kept = records.slice(0, SELECT_MAX_PASSAGES);
  const bodies = new Map<string, { body: string; ss: Range[] }>();
  const info = (r: IndexRecord) => {
    let b = bodies.get(r.id);
    if (!b) {
      const body = recordBody(r);
      b = { body, ss: sentences(body) };
      bodies.set(r.id, b);
    }
    return b;
  };
  const make = (record: IndexRecord, range: PassageRange): Passage => ({
    record,
    range,
    text: passageText(info(record).body, range, record.kind === 'photo'),
  });

  // Cores.
  const wants = answerKind(question);
  let passages: Passage[] = kept.map((record) => {
    const { body, ss } = info(record);
    if (record.kind === 'photo') return make(record, { start: 0, end: body.length });
    const given = ranges[record.id];
    let core = given ? clampRange(given, body.length) : bestWindow(body, question, PASSAGE_WINDOW_CHARS, wants);
    if (core.end <= core.start) core = bestWindow(body, question, PASSAGE_WINDOW_CHARS, wants);
    // The chunk that matched holds no fact of the kind asked for, and the item does elsewhere: read that part instead.
    else if (given && wants && !wants.test(body.slice(core.start, core.end)) && wants.test(body)) {
      const typed = bestWindow(body, question, PASSAGE_WINDOW_CHARS, wants);
      if (wants.test(body.slice(typed.start, typed.end))) core = typed;
    }
    core = snapToSentences(body, core, ss);
    core = capAtSentence(body, core, PASSAGE_MAX_CHARS, ss);
    return make(record, core);
  });

  // Hard budget: drop the lowest-ranked record (never the last one); a single oversized core is cut to fit.
  while (passages.length > 1 && estimate(question, passages, opts) > NANO_PROMPT_BUDGET) passages = passages.slice(0, -1);
  if (passages.length === 1 && estimate(question, passages, opts) > NANO_PROMPT_BUDGET) {
    const p = passages[0];
    const { body, ss } = info(p.record);
    let range = p.range;
    while (range.end - range.start > 1 && estimate(question, [make(p.record, range)], opts) > NANO_PROMPT_BUDGET) {
      const target = Math.floor((range.end - range.start) * 0.8);
      range = capAtSentence(body, range, Math.max(1, target), ss);
    }
    passages = [make(p.record, range)];
  }

  // Context: widen the cores by whole sentences while the estimate stays under the soft target. One sentence after
  // and one before per passage in each round, in rank order, so the room is shared: widening the first passage to the
  // full left the fourth with its core only, and the model picks from any place in the list.
  const cores = passages.map((p) => p.range);
  const done = passages.map((p) => p.record.kind === 'photo');
  const tryRange = (i: number, next: PassageRange): boolean => {
    const core = cores[i];
    if (next.end - next.start > PASSAGE_MAX_CHARS) return false;
    if (core.start - next.start > PASSAGE_CONTEXT_CHARS || next.end - core.end > PASSAGE_CONTEXT_CHARS) return false;
    const candidate = passages.map((q, k) => (k === i ? make(q.record, next) : q));
    if (estimate(question, candidate, opts) >= SELECT_TARGET_TOKENS) return false;
    passages = candidate;
    return true;
  };
  while (done.some((d) => !d)) {
    for (let i = 0; i < passages.length; i += 1) {
      if (done[i]) continue;
      const { ss } = info(passages[i].record);
      const after = ss.find((s) => s.start >= passages[i].range.end);
      const grewAfter = !!after && tryRange(i, { start: passages[i].range.start, end: after.end });
      const before = [...ss].reverse().find((s) => s.end <= passages[i].range.start);
      const grewBefore = !!before && tryRange(i, { start: before.start, end: passages[i].range.end });
      if (!grewAfter && !grewBefore) done[i] = true;
    }
  }
  return passages;
}

/** Verbatim excerpt for an answer (10 section 10.3): the 1 to 3 sentences that hold the answer's facts. */
export function deriveExcerpt(
  body: string,
  passage: PassageRange,
  answer: string,
): { excerpt: string; start?: number; end?: number; unsupported: string[] } {
  const bodyFacts = normalizedFacts(body);
  const present = new Set<string>();
  const unsupported: string[] = [];
  const seenUnsupported = new Set<string>();
  for (const raw of extractFacts(answer)) {
    const n = normFact(raw);
    if (bodyFacts.has(n)) present.add(n);
    else if (!seenUnsupported.has(n)) {
      seenUnsupported.add(n);
      unsupported.push(raw.trim());
    }
  }
  const aWords = stems(answer);
  const ss = sentences(body);

  type Win = { start: number; end: number; fh: number; wh: number };
  const better = (a: Win, b: Win | null) =>
    !b || a.fh > b.fh || (a.fh === b.fh && (a.wh > b.wh || (a.wh === b.wh && (a.end - a.start < b.end - b.start || (a.end - a.start === b.end - b.start && a.start < b.start)))));
  const search = (onlyOverlapping: boolean): Win | null => {
    let best: Win | null = null;
    for (let i = 0; i < ss.length; i += 1) {
      for (let len = 1; len <= 3 && i + len <= ss.length; len += 1) {
        const start = ss[i].start;
        const end = ss[i + len - 1].end;
        if (end - start > EXCERPT_MAX_CHARS) break;
        if (onlyOverlapping && (end <= passage.start || start >= passage.end)) continue;
        const text = body.slice(start, end);
        const facts = normalizedFacts(text);
        let fh = 0;
        for (const f of present) if (facts.has(f)) fh += 1;
        const winStems = stems(text);
        let wh = 0;
        for (const w of aWords) if (winStems.has(w)) wh += 1;
        const win = { start, end, fh, wh };
        if (better(win, best)) best = win;
      }
    }
    return best;
  };

  let best = search(true);
  if (!best || best.fh < present.size) {
    const whole = search(false);
    if (whole && better(whole, best)) best = whole;
  }
  const accepted =
    best !== null &&
    ((present.size > 0 && best.fh === present.size) || (present.size === 0 && aWords.size > 0 && best.wh / aWords.size >= 0.5));
  if (!accepted || !best) return { excerpt: '', unsupported };
  return { excerpt: body.slice(best.start, best.end), start: best.start, end: best.end, unsupported };
}

function nounFor(kinds: ItemKind[]): { one: string; many: string } {
  const first = kinds[0];
  if (kinds.length > 0 && kinds.every((k) => k === first)) {
    if (first === 'email') return { one: 'email', many: 'emails' };
    if (first === 'photo') return { one: 'photo', many: 'photos' };
    if (first === 'document') return { one: 'file', many: 'files' };
  }
  return { one: 'item', many: 'items' };
}

/** "3 emails", "1 photo", "2 items". */
export function countNoun(records: Pick<IndexRecord, 'kind'>[]): string {
  const n = nounFor(records.map((r) => r.kind));
  return `${records.length} ${records.length === 1 ? n.one : n.many}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

type RawSelect = { item: string; answer: string };

export async function selectAndAnswer(
  question: string,
  records: IndexRecord[],
  data: DataClass,
  opts?: SelectOptions,
): Promise<RunModelResult<SelectValue>> {
  if (records.length === 0) {
    return { ok: true, value: { recordId: null, answer: '', excerpt: '' }, trace: codeTrace('select', 'No items to read', 0) };
  }
  const today = opts?.today ?? Date.now();
  const promptOpts: PromptOpts = { hints: opts?.hints, today, latest: opts?.latest };
  const passages = fitPassages(question, records, opts?.passages ?? {}, promptOpts);
  const prompt = selectPrompt(question, passages, promptOpts);
  const dataChars =
    question.length + passages.reduce((n, p) => n + p.text.length + p.record.title.length + (p.record.from?.length ?? 0), 0);

  let lastShown = '';
  const onText = opts?.onAnswerText
    ? (raw: string) => {
        if (/"item"\s*:\s*"none"/.test(raw)) return;
        const prefix = collapseWhitespace(partialJsonString(raw, 'answer'));
        if (!prefix || prefix === lastShown) return;
        lastShown = prefix;
        opts.onAnswerText?.(prefix);
      }
    : undefined;

  // An answer the share-time checks would refuse for its shape (a list or several facts, or a long run copied from the
  // item) gets one more try with a line that says what to change. The second answer is taken as it comes: the checks
  // after this call still decide. Before, an open "what did they say about ..." question ended as unsupported in two test
  // runs of three because the first answer held several facts (Nov 22, 2026).
  // The same one try for a yes-or-no question answered with a sentence, which the share-time check also refuses.
  // An answer that reads as an instruction is never asked for again here: that refusal stands.
  let reminder: string | undefined;
  const run = () =>
    runModel<RawSelect>({
      purpose: 'select-answer',
      mode: data === 'own' ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE',
      data,
      system: SELECT_SYSTEM,
      schema: SELECT_SCHEMA,
      cloudSchema: SELECT_CLOUD_SCHEMA,
      prompt,
      recordIds: passages.map((p) => p.record.id),
      ownCloud: opts?.ownCloud,
      signal: opts?.signal,
      priority: 'foreground',
      dataChars,
      onText,
      validate: (v, attempt) => {
        const { item, answer } = v as RawSelect;
        if (item === 'none') return v;
        const k = /^P(\d+)$/.exec(item);
        if (!k || Number(k[1]) < 1 || Number(k[1]) > passages.length) return null;
        // JSON or a fence inside the answer ("...21st.}]") is bad output: retried once, never trimmed into a sentence
        reminder = undefined;
        if (!answer.trim() || leaksStructure(answer)) return null;
        if (attempt === 1) {
          const rec = (passages[Number(k[1]) - 1] as Passage).record;
          const shape = shapeAnswer(answer, rec, question, () => false);
          if ((!shape.ok && shape.reason === 'one-fact') || copiesTooMuch(answer, recordBody(rec))) {
            reminder = RESHAPE_REMINDER;
            return null;
          }
          if (!shape.ok && shape.reason === 'not-yes-no') {
            reminder = YES_NO_REMINDER;
            return null;
          }
          // "how much" answered with a date, "when" answered with no day in it: one more try, then the check after this call decides
          if (!isYesNoQuestion(question) && !answersKind(question, answer)) {
            reminder = kindReminder(question);
            return null;
          }
          // A date or an amount that is in neither the item, its subject, its date, the question nor today's date is
          // the model's own: one more try that names it. Whatever is left after that still gets its warning.
          const made = madeUpFacts(answer, rec, question, today);
          if (made.length > 0) {
            reminder = madeUpReminder(made[0] as string);
            return null;
          }
        }
        return v;
      },
      retryReminder: () => reminder ?? RETRY_REMINDER,
    });

  let res = await run();
  // 70 R-PLAT-16: sample data on a busy cloud model gets one retry after a short wait.
  if (!res.ok && res.error.code === 'quota' && data === 'sample') {
    try {
      await delay(TIMING.sampleQuotaRetryMs, opts?.signal);
      res = await run();
    } catch {
      // aborted while waiting: keep the first failure
    }
    if (!res.ok && res.error.code === 'quota') {
      const message = 'The cloud model is busy right now. Try again in a minute, or use Chrome with Gemini Nano to run it on this device.';
      return { ok: false, error: { code: 'quota', message }, trace: { ...res.trace, label: `Reading failed: ${message}` } };
    }
  }
  if (!res.ok) return res;

  const cloudOwn = res.trace.where === 'cloud' && data === 'own';
  const noneLabel = `Read ${countNoun(passages.map((p) => p.record))}; none of them answers the question`;
  const none = (trace: TraceStep): RunModelResult<SelectValue> => ({
    ok: true,
    value: { recordId: null, answer: '', excerpt: '' },
    trace: { ...trace, label: noneLabel },
  });
  if (res.value.item === 'none') return none(res.trace);
  const k = Number(res.value.item.slice(1));
  const passage = passages[k - 1];
  const answer = cleanModelSentence(res.value.answer, ANSWER_MAX_CHARS);
  if (!answer || REFUSAL_RE.test(answer)) return none(res.trace);

  const record = passage.record;
  let label = `Picked "${record.title}" and wrote the answer`;
  if (cloudOwn) label += `: ${res.trace.charsSent ?? 0} characters of your data left this device`;
  const trace = { ...res.trace, label };

  if (record.kind === 'photo') {
    const caption = recordBody(record);
    const unsupported = deriveExcerpt(caption, { start: 0, end: caption.length }, answer).unsupported;
    return {
      ok: true,
      value: {
        recordId: record.id, answer, excerpt: caption, excerptStart: 0, excerptEnd: caption.length, passage: passage.range,
        ...(unsupported.length ? { unsupported } : {}),
      },
      trace,
    };
  }
  const derived = deriveExcerpt(recordBody(record), passage.range, excerptBasis(answer, question));
  return {
    ok: true,
    value: {
      recordId: record.id,
      answer,
      excerpt: derived.excerpt,
      ...(derived.start !== undefined ? { excerptStart: derived.start, excerptEnd: derived.end } : {}),
      passage: passage.range,
      ...(derived.unsupported.length ? { unsupported: derived.unsupported } : {}),
    },
    trace,
  };
}
