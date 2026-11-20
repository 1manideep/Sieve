// Shared test helpers: corpus loading, a fake model host, span matching and precision/recall.
import type { IndexRecord, PiiStage } from '@sieve/shared';
import hiddenCases from '../__corpus__/hidden-html.json';
import injectionCases from '../__corpus__/injection-cases.json';
import piiCases from '../__corpus__/pii-cases.json';
import stepCases from '../__corpus__/step-cases.json';
import type { ModelSpan } from '../model/labels';
import { setPrivacyModelHost, type PiiModelHost } from '../model/client';
import { locateGold as locate } from '../dev/measure';
import type { PrivacyModelStatus } from '../types';

export interface HiddenCase {
  id: string; html: string; expectVisible: string[]; expectHidden: string[]; expectFragments?: number; note?: string;
  expectText?: string; expectAbsent?: string[]; codeSuspicious?: boolean; expectFragmentPrefix?: string; expectNoFragmentPrefix?: string;
}
import type { GoldSpan } from '../dev/measure';
export type { GoldSpan } from '../dev/measure';
export interface PiiCase { id: string; text: string; expect: GoldSpan[]; mustNotFlag?: string[]; stages?: PiiStage[] }
export interface InjectionCase { id: string; group: 1 | 2 | 3 | 4; text: string; html?: string; attack: boolean; codeShouldFlag: boolean; source: string; extraFromHidden?: boolean }
export interface StepExpect { available: boolean; text?: string; contains?: string[]; notContains?: string[]; reason?: string; redactions?: number; startsWith?: string; endsWith?: string; maxChars?: number }
export interface StepCase {
  id: string;
  record: Record<string, unknown>;
  parts: { answer?: string; excerpt?: string; full?: string };
  opts?: { maxStep?: 'answer' | 'excerpt' | 'full'; question?: string };
  expect: Partial<Record<'answer' | 'excerpt' | 'full', StepExpect>>;
}

export const HIDDEN_CASES = hiddenCases as HiddenCase[];
export const PII_FORMAT_CASES = (piiCases as { format: PiiCase[] }).format;
export const PII_PERSONA_CASES = (piiCases as { persona: PiiCase[] }).persona;
export const INJECTION_CASES = injectionCases as InjectionCase[];
export const STEP_CASES = stepCases as unknown as StepCase[];

/** JSON has null where IndexRecord has an absent field. */
export function toRecord(raw: Record<string, unknown>): IndexRecord {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== null) out[k] = v;
  return out as unknown as IndexRecord;
}

export { covers, formatScores, locateGold as locate, overlapsAny, scoreSpans, type TypeScore } from '../dev/measure';

/** A fake model host; `spansFor` decides what the "model" finds. */
export function fakeModelHost(spansFor: (text: string) => ModelSpan[], opts: { fail?: boolean; device?: 'webgpu' | 'wasm' } = {}): PiiModelHost & { calls: string[] } {
  let state: PrivacyModelStatus = { state: 'idle' };
  const calls: string[] = [];
  return {
    calls,
    async warmup() {
      if (opts.fail) {
        state = { state: 'failed', error: 'load-failed' };
        throw new Error('load-failed');
      }
      state = { state: 'ready', device: opts.device ?? 'wasm', loadMs: 1 };
    },
    async run(input) {
      calls.push(input.text);
      return { spans: spansFor(input.text) };
    },
    status: () => state,
    subscribe: () => () => undefined,
  };
}

/** Model spans for given words in text, with a label and score. */
export function modelSpansFor(text: string, words: { match: string; label: string; score: number; occurrence?: number }[]): ModelSpan[] {
  const out: ModelSpan[] = [];
  for (const w of words) {
    if (!text.includes(w.match)) continue;
    const at = locate(text, w.match, w.occurrence);
    out.push({ ...at, label: w.label, score: w.score });
  }
  return out;
}

export function noModel(): void {
  setPrivacyModelHost(null);
}
