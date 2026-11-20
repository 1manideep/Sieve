// checkInjection() (11 section 8): plain-code patterns, then the Nano advisory. A warning light, not a lock: the
// structural boundary of section 9 holds whatever this finds or misses.
import type { InjectionFinding, TraceStep } from '@sieve/shared';
import { INJECTION_QUOTE_MAX_CHARS, QUOTE_OVERLAP_MIN } from '../constants';
import { collapseSpaces, cutGraphemes, overlapTokens, sentenceRanges, throwIfAborted, type Range } from '../text';
import type { CheckInjectionOptions, PatternReport } from '../types';
import { nanoInjection } from './nano';
import { matchInjectionPatterns } from './patterns';

function bestOverlap(input: string, sentences: readonly Range[], words: ReadonlySet<string>): { r: Range; share: number } | null {
  let best: { r: Range; share: number } | null = null;
  for (const r of sentences) {
    const sWords = overlapTokens(input.slice(r.start, r.end));
    let shared = 0;
    for (const w of words) if (sWords.has(w)) shared++;
    const share = words.size > 0 ? shared / words.size : 0;
    if (!best || share > best.share) best = { r, share };
  }
  return best;
}

/** Finds the input sentence a quote refers to: it occurs in the input (whitespace and case folded), or one sentence
 * shares at least 60% of the quote's distinct words (8.2 step 4). */
export function locateQuote(input: string, quote: string): Range | null {
  const q = collapseSpaces(quote).toLowerCase();
  if (!q) return null;
  const sentences = sentenceRanges(input);
  const exact = sentences.find((r) => collapseSpaces(input.slice(r.start, r.end)).toLowerCase().includes(q));
  if (exact) return exact;
  const words = overlapTokens(quote);
  const best = bestOverlap(input, sentences, words);
  if (collapseSpaces(input).toLowerCase().includes(q)) return best?.r ?? null;   // a quote over several sentences
  return best && best.share >= QUOTE_OVERLAP_MIN ? best.r : null;
}

export interface InjectionDetail {
  finding: InjectionFinding;
  trace: TraceStep;
  nanoRan: boolean;
  nanoWhere?: 'device' | 'cloud';
  codeMs: number;
}

const LABELS = {
  both: 'Plain code and Gemini Nano both flagged a sentence aimed at an AI',
  nano: 'Gemini Nano flagged a sentence aimed at an AI (a warning, not a guarantee)',
  code: 'Plain code flagged a sentence aimed at an AI',
  noneBoth: 'No instructions aimed at an AI found (plain code and Gemini Nano)',
  noneCode: 'No instructions aimed at an AI found (plain code; Gemini Nano not used)',
  ignored: 'Gemini Nano raised a flag but its quote was not found in the text, so the flag was ignored',
};

export async function checkInjectionDetailed(text: string, data: 'own' | 'sample', opts: CheckInjectionOptions = {}): Promise<InjectionDetail> {
  throwIfAborted(opts.signal);
  const extra = (opts.extraText ?? []).filter((t) => t.trim());
  const at = Date.now();
  if (!text.trim() && extra.length === 0) {
    return { finding: { suspicious: false, by: 'code' }, trace: { kind: 'injection', label: 'Nothing to check', where: 'code', ms: 0, at }, nanoRan: false, codeMs: 0 };
  }
  const t0 = performance.now();
  let code: PatternReport = matchInjectionPatterns(text);
  for (const piece of extra) {
    const r = matchInjectionPatterns(piece);
    if (r.score > code.score) code = r;
  }
  const codeMs = Math.round(performance.now() - t0);

  const useModel = opts.model !== false && opts.allowNano !== false;
  if (!useModel) {
    const finding: InjectionFinding = code.suspicious ? { suspicious: true, quote: code.quote, by: 'code' } : { suspicious: false, by: 'code' };
    return { finding, trace: { kind: 'injection', label: code.suspicious ? LABELS.code : LABELS.noneCode, where: 'code', ms: codeMs, at }, nanoRan: false, codeMs };
  }

  const input = [text, ...extra].join('\n\n');
  const nano = await nanoInjection(input, data, { recordIds: opts.recordIds, signal: opts.signal });
  let verifiedQuote: string | undefined;
  let ignored = false;
  if (nano.ran && nano.suspicious) {
    const where = locateQuote(input, nano.quote);
    if (where) verifiedQuote = cutGraphemes(input.slice(where.start, where.end).trim(), INJECTION_QUOTE_MAX_CHARS);
    else ignored = true;
  }
  const suspicious = code.suspicious || verifiedQuote !== undefined;
  const finding: InjectionFinding = !suspicious
    ? { suspicious: false, by: 'code' }
    : verifiedQuote !== undefined
      ? { suspicious: true, quote: verifiedQuote, by: 'nano' }
      : { suspicious: true, quote: code.quote, by: 'code' };

  let label: string;
  if (!nano.ran) label = code.suspicious ? LABELS.code : LABELS.noneCode;
  else if (verifiedQuote !== undefined) label = code.suspicious ? LABELS.both : LABELS.nano;
  else if (code.suspicious) label = LABELS.code;
  else label = ignored ? LABELS.ignored : LABELS.noneBoth;

  const trace: TraceStep = nano.ran && nano.trace
    ? { ...nano.trace, kind: 'injection', label, ms: nano.ms + codeMs, charsSent: nano.charsSent, at }
    : { kind: 'injection', label, where: 'code', ms: codeMs, at };
  const detail: InjectionDetail = { finding, trace, nanoRan: nano.ran, codeMs };
  if (nano.ran) detail.nanoWhere = nano.where;
  return detail;
}

export async function checkInjection(text: string, data: 'own' | 'sample', opts: CheckInjectionOptions = {}): Promise<{ finding: InjectionFinding; trace: TraceStep }> {
  const { finding, trace } = await checkInjectionDetailed(text, data, opts);
  return { finding, trace };
}
