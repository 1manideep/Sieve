// detectPii() (11 section 5): validators, then the browser model, then Nano; merged, filtered and propagated.
import type { DataClass, PiiSpan, PiiStage, PiiType, TraceStep } from '@sieve/shared';
import { detectWithModel, getPrivacyModelStatus, ModelNotReadyError, ModelTimeoutError } from '../model/client';
import { cleanModelSpans } from '../model/clean';
import { piiTypeForLabel } from '../model/labels';
import { isAbortError, throwIfAborted } from '../text';
import type { DetectPiiOptions } from '../types';
import { locateEntities } from './locate';
import { filterSpans, finalizeSpans, mergeSpans } from './merge';
import { nanoPii } from './nano';
import { prepareValidators, runValidators } from './validators';

const SUMMARY_NAMES: Record<PiiType, [string, string]> = {
  email: ['email address', 'email addresses'],
  phone: ['phone number', 'phone numbers'],
  card: ['card number', 'card numbers'],
  iban: ['bank account (IBAN)', 'bank accounts (IBAN)'],
  ssn: ['Social Security number', 'Social Security numbers'],
  account: ['account number', 'account numbers'],
  name: ['name', 'names'],
  address: ['address', 'addresses'],
  dob: ['date of birth', 'dates of birth'],
  'secret-code': ['one-time code or sign-in link', 'one-time codes or sign-in links'],
  other: ['ID number', 'ID numbers'],
};
const SUMMARY_ORDER: readonly PiiType[] = ['secret-code', 'email', 'phone', 'card', 'iban', 'ssn', 'account', 'name', 'address', 'dob', 'other'];

/** "2 names, 1 phone number": counts by type, largest first. */
export function summarize(spans: readonly PiiSpan[]): string {
  const counts = new Map<PiiType, number>();
  for (const s of spans) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || SUMMARY_ORDER.indexOf(a[0]) - SUMMARY_ORDER.indexOf(b[0]))
    .map(([type, n]) => `${n} ${SUMMARY_NAMES[type][n === 1 ? 0 : 1]}`)
    .join(', ');
}

function codeStep(label: string, ms: number): TraceStep {
  return { kind: 'pii', label, where: 'code', ms, at: Date.now() };
}

function notCovered(spans: readonly PiiSpan[], prior: readonly PiiSpan[]): PiiSpan[] {
  return spans.filter((s) => !prior.some((p) => p.start < s.end && s.start < p.end));
}

export interface StageResult {
  spans: PiiSpan[];              // this stage's spans, filtered and merged within the stage
  trace: TraceStep;
  ran: boolean;                  // the stage really ran (a stamp may be written)
  where: 'code' | 'device' | 'cloud';
  ms: number;
}

export interface StageContext {
  data: DataClass;
  prior: readonly PiiSpan[];     // spans found so far (masks the Nano prompt; "found nothing more")
  recordIds?: string[];
  signal?: AbortSignal;
  priority?: 'foreground' | 'background';
  waitForModel?: boolean;        // default true
}

/** One PII stage on text, the same code detectPii and scanRecord use (11 section 6.1 runPiiStage). */
export async function runPiiStage(stage: PiiStage, text: string, ctx: StageContext): Promise<StageResult> {
  throwIfAborted(ctx.signal);
  if (stage === 'validators') {
    await prepareValidators();
    const t0 = performance.now();
    const spans = mergeSpans(runValidators(text));
    const ms = Math.round(performance.now() - t0);
    const label = spans.length > 0 ? `Plain code found ${summarize(spans)}` : 'Plain code found no phone, card, account or email details';
    return { spans, trace: codeStep(label, ms), ran: true, where: 'code', ms };
  }

  if (stage === 'model') {
    const t0 = performance.now();
    if (getPrivacyModelStatus().state === 'failed') {
      return { spans: [], trace: codeStep('The privacy model could not load on this device, so this check was skipped', 0), ran: false, where: 'code', ms: 0 };
    }
    try {
      const res = await detectWithModel(text, { signal: ctx.signal, priority: ctx.priority ?? 'background', wait: ctx.waitForModel ?? true });
      const raw: PiiSpan[] = [];
      for (const s of res.spans) {
        const type = piiTypeForLabel(s.label, text.slice(s.start, s.end));
        if (type) raw.push({ start: s.start, end: s.end, type, by: 'model', score: s.score });
      }
      const spans = mergeSpans(filterSpans(text, cleanModelSpans(text, filterSpans(text, raw))));
      const more = notCovered(spans, ctx.prior);
      const device = res.device ?? getPrivacyModelStatus().device;
      const label = more.length > 0 ? `The privacy model on this device found ${summarize(more)}` : 'The privacy model on this device found nothing more';
      const trace: TraceStep = { kind: 'pii', label, where: 'device', model: device === 'webgpu' ? 'Rampart (WebGPU)' : 'Rampart (WASM)', ms: res.ms, at: Date.now() };
      return { spans, trace, ran: true, where: 'device', ms: res.ms };
    } catch (e) {
      if (isAbortError(e) && ctx.signal?.aborted) throw e;
      const ms = Math.round(performance.now() - t0);
      const label = e instanceof ModelNotReadyError
        ? 'The privacy model is not ready on this device, so this check was skipped'
        : e instanceof ModelTimeoutError || getPrivacyModelStatus().state === 'ready'
          ? 'The privacy model did not finish on this device, so this check was skipped'
          : 'The privacy model could not load on this device, so this check was skipped';
      return { spans: [], trace: codeStep(label, ms), ran: false, where: 'code', ms };
    }
  }

  const res = await nanoPii(text, ctx.prior, ctx.data, { recordIds: ctx.recordIds, signal: ctx.signal, priority: ctx.priority });
  const spans = mergeSpans(filterSpans(text, res.spans));
  if (!res.trace || res.skipped) {
    const label = res.skipped === 'failed'
      ? 'Gemini Nano could not finish the last check, so it was skipped'
      : 'Gemini Nano is not available on this device, so the last check was skipped';
    return { spans, trace: codeStep(label, res.ms), ran: false, where: 'code', ms: res.ms };
  }
  const label = spans.length > 0 ? `Gemini Nano on this device found ${summarize(spans)}` : 'Gemini Nano on this device found nothing more';
  const where = res.trace.sdkReported === 'in_cloud' ? 'cloud' : 'device';
  return { spans, trace: { ...res.trace, kind: 'pii', label, ms: res.ms }, ran: res.ran, where, ms: res.ms };
}

const ALL_STAGES: readonly PiiStage[] = ['validators', 'model', 'nano'];

export interface DetectInternal { waitForModel?: boolean; priority?: 'foreground' | 'background' }

export async function detectPiiInternal(text: string, data: DataClass, opts: DetectPiiOptions, internal: DetectInternal): Promise<{ spans: PiiSpan[]; trace: TraceStep[] }> {
  throwIfAborted(opts.signal);
  const requested = opts.stages ?? ALL_STAGES;
  const stages = ALL_STAGES.filter((s) => requested.includes(s) && !(s === 'nano' && opts.allowNano === false));
  const trace: TraceStep[] = [];
  let spans: PiiSpan[] = [];
  let knownLocated = false;
  const locateKnown = () => {                                   // step 2: after the validators, before the models
    if (!knownLocated && opts.known?.length) spans = [...spans, ...locateEntities(text, opts.known)];
    knownLocated = true;
  };
  for (const stage of stages) {
    if (stage !== 'validators') locateKnown();
    const res = await runPiiStage(stage, text, {
      data, prior: spans, recordIds: opts.recordIds, signal: opts.signal,
      waitForModel: internal.waitForModel ?? true, priority: internal.priority ?? 'background',
    });
    spans = [...spans, ...res.spans];
    trace.push(res.trace);
  }
  locateKnown();
  return { spans: finalizeSpans(text, spans), trace };
}

/** Runs the requested stages on text; offsets into text. Throws only an AbortError; stage failures are trace entries. */
export function detectPii(text: string, data: DataClass, opts: DetectPiiOptions = {}): Promise<{ spans: PiiSpan[]; trace: TraceStep[] }> {
  return detectPiiInternal(text, data, opts, {});
}
