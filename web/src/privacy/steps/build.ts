// buildStepOption() (11 section 10): the exact outgoing text of one ladder step. Plain code only, on the cached
// findings; a stale record is scanned in memory first (without waiting for the browser model). The share-time Gemini
// Nano check (shareCheck.ts, 10.7) reads the built text and hands its findings back as extraEntities and extraQuotes.
import type { DataClass, IndexRecord, LadderStep, SharedImage, StepOption, TraceStep } from '@sieve/shared';
import { LADDER_STEPS, MAX_PAYLOAD_CHARS } from '@sieve/shared';
import { ANSWER_MAX_CHARS, REMOVED_SENTENCE } from '../constants';
import { locateQuote } from '../injection/check';
import { matchInjectionPatterns, suspiciousSentences } from '../injection/patterns';
import { shortenLinks } from '../links';
import { locateEntities } from '../pii/locate';
import { finalizeSpans } from '../pii/merge';
import { prepareValidators, runValidators } from '../pii/validators';
import { findActorNames } from '../pii/validators/names';
import { findSecretCodes } from '../pii/validators/secretCode';
import { redact } from '../redact';
import { cleanChars } from '../sanitize/chars';
import { expectedStages, isScanCurrent, knownEntities, memoScan, scanText } from '../scan/scan';
import { collapseSpaces, ensureWellFormed, isAbortError, plural, type Range } from '../text';
import type { BuildStepOptions } from '../types';
import { answerKeepTypes, cleanAnswer } from './answer';
import { dropSubject, leaksStructure, shapeAnswer } from './answerShape';
import { keepAskerWords, notTheCompany, personSender, senderEntities, senderWordsOf } from './asker';
import { excerptHeader, locateExcerpt } from './excerpt';
import { capFull, fullHeader, lastCutBefore } from './full';
import { copiesTooMuch, hiddenLeak } from './invariants';
import { photoExcerptText, photoFullText, preparePhotoForShare } from './photo';
import { dropPublicValues } from './publicValues';

export const UNAVAILABLE = {
  maxAnswer: 'This assistant may only receive the answer.',
  maxExcerpt: 'This assistant may only receive the answer or an excerpt.',
  noAnswer: 'No answer was written for this item.',
  noExcerpt: 'No lines were picked from this item.',
  excerptNotFound: 'Could not find the exact lines in the item.',
  noText: 'This item has no text to share.',
  noPhoto: 'This photo is not available to share.',
  verbatim: 'The answer repeated too much of the original wording.',
  answerInstruction: 'The answer looked like an instruction, so it is not offered.',
  hidden: 'Hidden text was found in this step, so it is not offered.',
  stillInstruction: 'This text still looked like an instruction to an AI, so it is not offered.',
  empty: 'Nothing is left to share after hiding personal details.',
  failed: 'Could not check this text for personal details.',
  // 10.3a (Nov 21): the answer-step output checks
  oneFact: 'Sieve shares one fact at a time at this level.',
  notYesNo: "The answer wasn't a plain yes or no.",
  metadataOnly: 'Nothing is left once the subject line and the address are left out.',
  badOutput: 'The answer was not one clean sentence, so it is not offered.',
} as const;

function unavailable(step: LadderStep, reason: string): StepOption {
  return { step, text: '', chars: 0, redactions: 0, available: false, unavailableReason: reason };
}

/**
 * S5 for excerpt and full: replaces sentences the patterns score as suspicious, the cached finding's sentence and the
 * sentences the share-time Nano check flagged.
 */
export function removeInjectedSentences(text: string, quote: string | undefined, more: readonly string[] = []): { text: string; count: number } {
  const ranges: Range[] = [...suspiciousSentences(text)];
  for (const q of [quote, ...more]) {
    if (!q) continue;
    const at = locateQuote(text, q);
    if (at) ranges.push(at);
  }
  if (ranges.length === 0) return { text, count: 0 };
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  let out = '';
  let pos = 0;
  for (const r of merged) {
    out += text.slice(pos, r.start) + REMOVED_SENTENCE;
    pos = r.end;
  }
  return { text: out + text.slice(pos), count: merged.length };
}

function traceLabel(masked: number, links: number, removed: number): string {
  const parts: string[] = [];
  if (masked > 0) parts.push(`masked ${plural(masked, 'personal detail', 'personal details')}`);
  if (links > 0) parts.push(`shortened ${plural(links, 'link', 'links')}`);
  if (removed > 0) parts.push(`removed ${plural(removed, 'sentence aimed at an AI', 'sentences aimed at an AI')}`);
  if (parts.length === 0) return 'Plain code found no personal details to mask';
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Plain code ${list} on this device`;
}

export async function buildStepOption(
  step: LadderStep,
  parts: { answer?: string; excerpt?: string; full?: string },
  record: IndexRecord,
  data: DataClass,
  opts: BuildStepOptions = {},
): Promise<StepOption> {
  const t0 = performance.now();
  const maxStep = opts.maxStep ?? 'full';
  if (LADDER_STEPS.indexOf(step) > LADDER_STEPS.indexOf(maxStep)) {
    return unavailable(step, maxStep === 'answer' ? UNAVAILABLE.maxAnswer : UNAVAILABLE.maxExcerpt);
  }
  const isPhoto = record.kind === 'photo';
  if (step === 'answer' && !parts.answer?.trim()) return unavailable(step, UNAVAILABLE.noAnswer);
  if (step === 'excerpt' && ((!record.text && !isPhoto) || !parts.excerpt?.trim())) return unavailable(step, UNAVAILABLE.noExcerpt);
  if (step === 'full' && !isPhoto && !(record.text ?? '').trim()) return unavailable(step, UNAVAILABLE.noText);

  let image: SharedImage | undefined;
  if (step === 'full' && isPhoto) {
    if (!opts.photo) return unavailable(step, UNAVAILABLE.noPhoto);
    const prepared = await preparePhotoForShare(opts.photo);
    if (!prepared.ok) return unavailable(step, prepared.reason || UNAVAILABLE.noPhoto);
    image = prepared.image;
  }

  try {
    // 1. scan freshness: a stale record is scanned once in memory (shared by parallel calls), and the caller persists it
    let rec = record;
    const scanData = data === 'sample' ? 'sample' : 'own';
    const rule = opts.rule ?? 'approve';
    const expected = await expectedStages(record, scanData, rule, { allowNano: opts.allowNano, readyModelOnly: true });
    if (!isScanCurrent(record, expected)) {
      const { patch } = await memoScan(record, scanData, { rule, signal: opts.signal, allowNano: opts.allowNano, priority: 'foreground', waitForModel: false });
      rec = { ...record, ...patch };
      opts.onScanned?.(patch);
    }
    await prepareValidators();

    // 2. raw text
    let raw: string;
    if (step === 'answer') {
      raw = cleanAnswer(parts.answer ?? '');
    } else if (step === 'excerpt') {
      if (isPhoto) raw = photoExcerptText(rec);
      else {
        const at = locateExcerpt(rec.text ?? '', parts.excerpt ?? '');
        if (!at) return unavailable(step, UNAVAILABLE.excerptNotFound);
        raw = `${excerptHeader(rec)}\n${(rec.text ?? '').slice(at.start, at.end)}`;
      }
    } else {
      raw = isPhoto ? photoFullText(rec) : `${fullHeader(rec)}\n\n${parts.full !== undefined ? cleanChars(parts.full).text : rec.text ?? ''}`;
    }

    // 3. invisible characters (a model output may carry some)
    let text = cleanChars(raw).text;
    if (step === 'answer' && copiesTooMuch(text, scanText(rec))) return unavailable(step, UNAVAILABLE.verbatim);   // S3
    if (step === 'answer') {
      // 10.3a: yes or no, one fact, no sender address (the subject line is dropped after redaction, step 8a)
      const shaped = shapeAnswer(text, rec, opts.question, (f) => personSender(f) !== null);
      if (!shaped.ok) return unavailable(step, shaped.reason === 'one-fact' ? UNAVAILABLE.oneFact : shaped.reason === 'not-yes-no' ? UNAVAILABLE.notYesNo : UNAVAILABLE.metadataOnly);
      text = shaped.text;
    }

    // 4. links
    const links = shortenLinks(text);
    text = links.text;

    // 5. injection
    let removed = 0;
    const extraQuotes = opts.extraQuotes ?? [];
    if (step === 'answer') {
      if (matchInjectionPatterns(text).suspicious) return unavailable(step, UNAVAILABLE.answerInstruction);
      const folded = collapseSpaces(text).toLowerCase();
      if (extraQuotes.some((q) => q.trim() && folded.includes(collapseSpaces(q).toLowerCase()))) return unavailable(step, UNAVAILABLE.answerInstruction);
    } else {
      const r = removeInjectedSentences(text, rec.injection?.quote, extraQuotes);
      text = r.text;
      removed = r.count;
    }

    // 6. spans (plain code only): validators, one-time codes and sign-in links, names in "X sent you an email", plus
    // everything already known about this record and its sender (and, at share time, what Gemini Nano found in the
    // outgoing text). What the asker typed in the question is never masked; one-time codes always are.
    // An ID number must read as one, and a sender of the index is never one ("Z1llow", "1Password", 5.6 step 1).
    // The company sender's own name is never masked as a person's: in "Good Dog sent you" (every step), and in the
    // answer whatever found it (10.3a: organisation names stay, they are often the answer).
    // Dates, times, labelled reference numbers and places that are not a street address are not personal details
    // (publicValues.ts), and the identifiers the caller gave as terms count as typed.
    const known = [...knownEntities(rec), ...senderEntities(rec), ...(opts.extraEntities ?? [])];
    const actors = step === 'answer' ? findActorNames(text) : notTheCompany(text, findActorNames(text), rec);
    const senders = senderWordsOf(rec, opts.knownSenders);
    const finalized = finalizeSpans(text, [...runValidators(text), ...findSecretCodes(text), ...actors, ...locateEntities(text, known)], { senders });
    const found = dropPublicValues(text, step === 'answer' ? notTheCompany(text, finalized, rec) : finalized, scanText(rec));
    const asked = [opts.question, ...(opts.terms ?? [])].filter((t) => t?.trim()).join('\n');
    const spans = keepAskerWords(text, found, asked || undefined);

    // 7, 8. answer exemptions, then redaction
    const keepTypes = step === 'answer' && opts.question ? answerKeepTypes(opts.question) : [];
    const red = redact(text, spans, { keepTypes });
    text = red.text;
    if (step === 'answer') {
      // 8a (10.3a): never the subject line, after redaction so the code check above still saw its words
      const dropped = dropSubject(text, rec, opts.question);
      if (!dropped.ok) return unavailable(step, UNAVAILABLE.metadataOnly);
      text = dropped.text;
    }

    // 9. caps, hidden leaks, the final pattern check
    if (step === 'full') text = capFull(text);
    else {
      const cap = step === 'answer' ? ANSWER_MAX_CHARS : MAX_PAYLOAD_CHARS;
      if (text.length > cap) text = text.slice(0, lastCutBefore(text, cap)).trimEnd();
    }
    if (step === 'answer' && leaksStructure(text)) return unavailable(step, UNAVAILABLE.badOutput);                   // never "...}]."
    if (hiddenLeak(text, rec)) return unavailable(step, UNAVAILABLE.hidden);                                         // S4
    if (step !== 'answer' && matchInjectionPatterns(text).suspicious) return unavailable(step, UNAVAILABLE.stillInstruction);   // S5
    if (!text.trim()) return unavailable(step, UNAVAILABLE.empty);
    text = ensureWellFormed(text).text;

    // 10. the option
    const redactions = links.count + removed + red.redactions;
    const trace: TraceStep = { kind: 'pii', label: traceLabel(red.redactions, links.count, removed), where: 'code', ms: Math.round(performance.now() - t0), at: Date.now() };
    const option: StepOption = { step, text, chars: text.length, redactions, available: true, trace: [trace] };
    if (image) option.image = image;
    return option;
  } catch (e) {
    if (isAbortError(e) && opts.signal?.aborted) throw e;
    return unavailable(step, UNAVAILABLE.failed);                                                                   // S7
  }
}
