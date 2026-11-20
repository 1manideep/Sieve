// The share-time Gemini Nano check (11 section 10.7, Nov 20). Indexing runs no Nano call any more (6.1); instead,
// once the step options of an item are built, Nano reads only the text that would leave: one injection-check and one
// pii-check at most, in the foreground. Own data stays ONLY_ON_DEVICE (the injection check of sample data may use the
// cloud, as it did at ingest). The result is cached on the record, keyed by its content hash, its text hash and the
// exact range checked, so a second approve of the same text runs nothing. Nano unavailable: nothing runs, the trace
// says so, and plain code plus the ingest-time findings still apply, as before.
import { LADDER_STEPS } from '@sieve/shared';
import type { IndexRecord, KnownEntity, PiiSpan, StepOption, TraceStep, Where } from '@sieve/shared';
import { getNanoAvailability } from '../../ai';
import { INJECTION_QUOTE_MAX_CHARS, SHARE_CHECKS_MAX, STAGE_VERSIONS } from '../constants';
import { cyrb53 } from '../hash';
import { locateQuote } from '../injection/check';
import { nanoInjection } from '../injection/nano';
import { runPiiStage, summarize } from '../pii/detect';
import { recordTextHash } from '../scan/scan';
import { cutGraphemes } from '../text';
import { cleanAnswer } from './answer';
import { locateExcerpt } from './excerpt';

/** One share-time check of one outgoing text, kept on the record (`shareChecks`, newest first). */
export interface ShareCheck {
  key: string;                    // content hash, scan-text hash and the exact range that was checked
  injection?: { version: string; ran: 'device' | 'cloud'; ms: number; at: number; quote?: string };
  pii?: { version: string; ran: 'device' | 'cloud'; ms: number; at: number; entities: KnownEntity[] };
}

/** An IndexRecord with its share-time cache (a field only this module reads and writes). */
export type ShareCheckedRecord = IndexRecord & { shareChecks?: ShareCheck[] };

export interface OutgoingCheck {
  entities: KnownEntity[];        // personal details Gemini Nano found in the text (by 'nano'), to mask in every step
  quotes: string[];               // sentences Gemini Nano flagged as aimed at an AI, found in the text
  trace: TraceStep[];             // the injection step, then the pii step (none when nothing would leave)
  nanoPii: boolean;               // Gemini Nano's personal-details check covered this text, now or before
  ran: number;                    // model calls made now (0 for a cached result)
  shareChecks?: ShareCheck[];     // the record's new cache, to save with the version-checked write
}

export interface OutgoingCheckOptions {
  signal?: AbortSignal;
  /** A live trace row starts (the pipeline shows "Checking for hidden instructions..." with where it runs). */
  onStart?(kind: 'injection' | 'pii', where: Where): void;
  onEnd?(kind: 'injection' | 'pii', step: TraceStep): void;
}

export const SHARE_CHECK_LABELS = {
  injectionNone: 'No hidden instructions in the text to share',
  injectionFlagged: 'Found a sentence aimed at an AI in the text to share, so Sieve keeps it out',
  injectionIgnored: 'Gemini Nano raised a flag, but its quote is not in the text to share, so the flag was ignored',
  injectionSkipped: 'Gemini Nano is not available, so this check was skipped. Plain code still removes the instructions it finds.',
  injectionFailed: 'Gemini Nano could not finish this check. Plain code still removes the instructions it finds.',
  injectionEarlier: (flagged: boolean) =>
    flagged ? 'This exact text was checked before: one sentence aimed at an AI is kept out' : 'This exact text was checked before: no hidden instructions',
  piiNone: 'No more personal details in the text to share',
  piiFound: (summary: string) => `Found and masked ${summary} in the text to share`,
  piiSkipped: 'Gemini Nano is not available, so this check was skipped. Plain code and the earlier checks still apply.',
  piiFailed: 'Gemini Nano could not finish this check. Plain code and the earlier checks still apply.',
  piiEarlier: (summary: string | null) =>
    summary ? `This exact text was checked before: ${summary} masked` : 'This exact text was checked before: no more personal details',
};

function codeStep(kind: 'injection' | 'pii', label: string): TraceStep {
  return { kind, label, where: 'code', ms: 0, at: Date.now() };
}

function rangeOf(step: StepOption['step'], parts: { answer?: string; excerpt?: string }, record: IndexRecord): string {
  if (step === 'full') return 'full';
  if (step === 'excerpt') {
    if (record.kind === 'photo') return 'excerpt:caption';
    const at = locateExcerpt(record.text ?? '', parts.excerpt ?? '');
    return at ? `excerpt:${at.start}-${at.end}` : `excerpt:${cyrb53(parts.excerpt ?? '').toString(36)}`;
  }
  return `answer:${cyrb53(cleanAnswer(parts.answer ?? '')).toString(36)}`;
}

/**
 * The text Nano reads: the widest step that would leave (full, else excerpt, else answer). The excerpt is added when
 * the full text was cut before it, so every offered text is covered by one call each.
 */
export function outgoingForCheck(
  options: readonly StepOption[],
  parts: { answer?: string; excerpt?: string },
  record: IndexRecord,
): { text: string; range: string } | null {
  const offered = options.filter((o) => o.available && o.text.trim());
  if (offered.length === 0) return null;
  const widest = offered.reduce((a, b) => (LADDER_STEPS.indexOf(b.step) > LADDER_STEPS.indexOf(a.step) ? b : a));
  let text = widest.text;
  let range = rangeOf(widest.step, parts, record);
  const excerpt = offered.find((o) => o.step === 'excerpt');
  if (widest.step === 'full' && excerpt) {
    const body = excerpt.text.slice(excerpt.text.indexOf('\n') + 1).trim();
    if (body && !text.includes(body)) {
      text = `${text}\n\n${excerpt.text}`;
      range += `+${rangeOf('excerpt', parts, record)}`;
    }
  }
  return { text, range };
}

export function shareCheckKey(record: IndexRecord, range: string): string {
  return `${record.contentHash}|${recordTextHash(record)}|${range}`;
}

function entitiesOf(text: string, spans: readonly PiiSpan[]): KnownEntity[] {
  const out: KnownEntity[] = [];
  const seen = new Set<string>();
  for (const s of spans) {
    const value = text.slice(s.start, s.end).trim();
    const key = `${s.type}\u0000${value}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push({ text: value, type: s.type, by: 'nano' });
  }
  return out;
}

/** "1 name, 1 address": one count per distinct detail, however often it occurs. */
function entitySummary(entities: readonly KnownEntity[]): string {
  return summarize(entities.map((e) => ({ start: 0, end: 0, type: e.type, by: 'nano' as const })));
}

async function nanoText(): Promise<string> {
  try {
    return (await getNanoAvailability()).text;
  } catch {
    return 'unavailable';
  }
}

/**
 * Checks the outgoing text of an item with Gemini Nano (or reads the cached result), and says what to mask and remove.
 * Throws only an AbortError; a failed or missing model is a trace row, never a silent pass (P4).
 */
export async function checkOutgoing(
  record: IndexRecord,
  data: 'own' | 'sample',
  options: readonly StepOption[],
  parts: { answer?: string; excerpt?: string },
  opts: OutgoingCheckOptions = {},
): Promise<OutgoingCheck> {
  const outgoing = outgoingForCheck(options, parts, record);
  if (!outgoing) return { entities: [], quotes: [], trace: [], nanoPii: false, ran: 0 };
  const { text } = outgoing;
  const key = shareCheckKey(record, outgoing.range);
  const previous = (record as ShareCheckedRecord).shareChecks ?? [];
  const cached = previous.find((c) => c.key === key);
  const entry: ShareCheck = { key };
  if (cached?.injection?.version === STAGE_VERSIONS.nanoInjection) entry.injection = cached.injection;
  if (cached?.pii?.version === STAGE_VERSIONS.nanoPii) entry.pii = cached.pii;
  const fromCache = { injection: !!entry.injection, pii: !!entry.pii };
  const nano = fromCache.injection && fromCache.pii ? 'available' : await nanoText();
  const trace: TraceStep[] = [];
  let ran = 0;
  let changed = false;
  const recordIds = [record.id];

  // 1. Hidden instructions. Sample data may use the cloud when there is no Nano (PREFER_ON_DEVICE), as before.
  const injectionWhere: Where = fromCache.injection ? 'code' : nano === 'available' ? 'device' : data === 'sample' ? 'cloud' : 'code';
  opts.onStart?.('injection', injectionWhere);
  let injectionStep: TraceStep;
  if (entry.injection) {
    injectionStep = codeStep('injection', SHARE_CHECK_LABELS.injectionEarlier(!!entry.injection.quote));
  } else if (nano !== 'available' && data === 'own') {
    injectionStep = codeStep('injection', SHARE_CHECK_LABELS.injectionSkipped);
  } else {
    const res = await nanoInjection(text, data, { recordIds, signal: opts.signal, priority: 'foreground' });
    ran += 1;
    if (res.ran && res.trace) {
      let quote: string | undefined;
      let ignored = false;
      if (res.suspicious) {
        const at = locateQuote(text, res.quote);
        if (at) quote = cutGraphemes(text.slice(at.start, at.end).trim(), INJECTION_QUOTE_MAX_CHARS);
        else ignored = true;
      }
      entry.injection = { version: STAGE_VERSIONS.nanoInjection, ran: res.where, ms: res.ms, at: Date.now(), ...(quote ? { quote } : {}) };
      changed = true;
      const label = quote ? SHARE_CHECK_LABELS.injectionFlagged : ignored ? SHARE_CHECK_LABELS.injectionIgnored : SHARE_CHECK_LABELS.injectionNone;
      injectionStep = { ...res.trace, kind: 'injection', label, ms: res.ms, charsSent: res.charsSent, at: Date.now() };
    } else {
      injectionStep = codeStep('injection', nano === 'available' ? SHARE_CHECK_LABELS.injectionFailed : SHARE_CHECK_LABELS.injectionSkipped);
    }
  }
  trace.push(injectionStep);
  opts.onEnd?.('injection', injectionStep);

  // 2. Personal details. Always on the device (P2): without Nano the check is skipped.
  const piiWhere: Where = fromCache.pii ? 'code' : nano === 'available' ? 'device' : 'code';
  opts.onStart?.('pii', piiWhere);
  let piiStep: TraceStep;
  if (entry.pii) {
    piiStep = codeStep('pii', SHARE_CHECK_LABELS.piiEarlier(entry.pii.entities.length > 0 ? entitySummary(entry.pii.entities) : null));
  } else if (nano !== 'available') {
    piiStep = codeStep('pii', SHARE_CHECK_LABELS.piiSkipped);
  } else {
    const res = await runPiiStage('nano', text, { data, prior: [], recordIds, signal: opts.signal, priority: 'foreground' });
    ran += 1;
    if (res.ran) {
      const entities = entitiesOf(text, res.spans);
      entry.pii = { version: STAGE_VERSIONS.nanoPii, ran: res.where === 'cloud' ? 'cloud' : 'device', ms: res.ms, at: Date.now(), entities };
      changed = true;
      piiStep = { ...res.trace, label: entities.length > 0 ? SHARE_CHECK_LABELS.piiFound(entitySummary(entities)) : SHARE_CHECK_LABELS.piiNone };
    } else {
      piiStep = codeStep('pii', SHARE_CHECK_LABELS.piiFailed);
    }
  }
  trace.push(piiStep);
  opts.onEnd?.('pii', piiStep);

  const result: OutgoingCheck = {
    entities: entry.pii?.entities ?? [],
    quotes: entry.injection?.quote ? [entry.injection.quote] : [],
    trace,
    nanoPii: !!entry.pii,
    ran,
  };
  if (changed) result.shareChecks = [entry, ...previous.filter((c) => c.key !== key)].slice(0, SHARE_CHECKS_MAX);
  return result;
}
