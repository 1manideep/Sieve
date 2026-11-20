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
import { SELECT_CLOUD_SCHEMA, SELECT_SCHEMA, SELECT_SYSTEM } from '../prompts';
import { runModel } from '../runModel';
import { cleanModelSentence, collapseWhitespace, escapeDelimiters, localDay, promptField, sentences, stems, type Range } from '../text';
import { codeTrace } from '../trace';
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
}

const FIELD_CHARS = 140;
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

/** The run of consecutive sentences (at most maxChars) holding the most question stems; ties go to the earliest. */
export function bestWindow(text: string, question: string, maxChars: number): PassageRange {
  if (text.length <= maxChars) return { start: 0, end: text.length };
  const ss = sentences(text);
  if (ss.length === 0) return { start: 0, end: maxChars };
  const q = stems(question);
  const score = ss.map((s) => {
    const sentenceStems = stems(text.slice(s.start, s.end));
    let n = 0;
    for (const w of q) if (sentenceStems.has(w)) n += 1;
    return n;
  });
  let best: { start: number; end: number; total: number } | null = null;
  for (let i = 0; i < ss.length; i += 1) {
    if (ss[i].end - ss[i].start > maxChars) {
      const candidate = { start: ss[i].start, end: ss[i].start + maxChars, total: score[i] };
      if (!best || candidate.total > best.total) best = candidate;
      continue;
    }
    let total = 0;
    let j = i;
    while (j < ss.length && ss[j].end - ss[i].start <= maxChars) {
      total += score[j];
      j += 1;
    }
    if (!best || total > best.total) best = { start: ss[i].start, end: ss[j - 1].end, total };
  }
  return best ? { start: best.start, end: best.end } : { start: 0, end: maxChars };
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

function recordDay(r: IndexRecord): string {
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
export function selectPrompt(question: string, passages: Passage[], opts?: { hints?: QueryHints; today?: number }): string {
  const head = [`Today is ${localDay(opts?.today ?? Date.now())}.`, `Question: ${promptField(question, 600)}`, ...hintLines(opts?.hints)];
  return [head.join('\n'), ...passages.map((p, i) => passageBlock(p, i + 1))].join('\n\n');
}

function estimate(question: string, passages: Passage[], opts?: { hints?: QueryHints; today?: number }): number {
  return estimatePromptTokens({ system: SELECT_SYSTEM, texts: [selectPrompt(question, passages, opts)], images: 0, schema: SELECT_SCHEMA });
}

/** Passages for at most SELECT_MAX_PASSAGES records, in rank order, within the prompt budget (10 section 10.3). */
export function fitPassages(
  question: string,
  records: IndexRecord[],
  ranges: Record<string, PassageRange>,
  opts?: { hints?: QueryHints; today?: number },
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
  let passages: Passage[] = kept.map((record) => {
    const { body, ss } = info(record);
    if (record.kind === 'photo') return make(record, { start: 0, end: body.length });
    const given = ranges[record.id];
    let core = given ? clampRange(given, body.length) : bestWindow(body, question, PASSAGE_WINDOW_CHARS);
    if (core.end <= core.start) core = bestWindow(body, question, PASSAGE_WINDOW_CHARS);
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

  // Context: widen each core in rank order by whole sentences while the estimate stays under the soft target.
  for (let i = 0; i < passages.length; i += 1) {
    const p = passages[i];
    if (p.record.kind === 'photo') continue;
    const { ss } = info(p.record);
    const core = p.range;
    let range = core;
    const tryRange = (next: PassageRange): boolean => {
      if (next.end - next.start > PASSAGE_MAX_CHARS) return false;
      if (core.start - next.start > PASSAGE_CONTEXT_CHARS || next.end - core.end > PASSAGE_CONTEXT_CHARS) return false;
      const candidate = passages.map((q, k) => (k === i ? make(q.record, next) : q));
      if (estimate(question, candidate, opts) >= SELECT_TARGET_TOKENS) return false;
      range = next;
      passages = candidate;
      return true;
    };
    for (;;) {
      const prev = [...ss].reverse().find((s) => s.end <= range.start);
      if (!prev || !tryRange({ start: prev.start, end: range.end })) break;
    }
    for (;;) {
      const next = ss.find((s) => s.start >= range.end);
      if (!next || !tryRange({ start: range.start, end: next.end })) break;
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
  const passages = fitPassages(question, records, opts?.passages ?? {}, { hints: opts?.hints, today });
  const prompt = selectPrompt(question, passages, { hints: opts?.hints, today });
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
      validate: (v) => {
        const { item, answer } = v as RawSelect;
        if (item === 'none') return v;
        const k = /^P(\d+)$/.exec(item);
        if (!k || Number(k[1]) < 1 || Number(k[1]) > passages.length) return null;
        return answer.trim() ? v : null;
      },
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
  const derived = deriveExcerpt(recordBody(record), passage.range, answer);
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
