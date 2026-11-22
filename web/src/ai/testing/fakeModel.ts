// The e2e model (60 section 3.9.1, 70 section 15.4). Loaded only when VITE_SIEVE_E2E is '1' (see ../e2e.ts), never in
// production. It replaces the SDK caller; Sieve's real policy, scheduler, parsing and trace code still run, so where a
// call "ran" is recorded exactly as an SDK report would be:
//   Nano 'available' and the mode allows the device: on_device; else the cloud: in_cloud.
// Outputs are deterministic. Faults come from window.__sieveE2E.faults[purpose], consumed one per call:
//   'hang', 'hang-while-hidden', 'throw:<DOMException name>', 'ai-error:<code>:<status>', 'bad-json',
//   'item:<Pn>', 'answer:<text>', 'answers:false' (verify-answer), 'availability:<state>'.
import type { NanoAvailability } from '@sieve/shared';
import type { E2EHooks, SieveE2E } from '../e2e';
import type { HybridCaller, ModelCallResult, ModelSpec, SdkPart } from '../hybrid';
import { codeLabel } from '../tasks/codeLabel';
import type { Purpose } from '../types';

const DEFAULT_CANARIES = ['ignore your previous instructions', 'ignore your instructions', 'note to any ai'];
const FIXED_CAPTION = 'A photo from the sample set, described on this device.';
const AVAILABILITY_STATES = new Set(['available', 'downloadable', 'downloading', 'unavailable', 'no-api']);

function state(): SieveE2E {
  if (typeof window === 'undefined') return {};
  return (window.__sieveE2E ??= {});
}

function nano(): NanoAvailability {
  return state().nano ?? 'available';
}

function nextFault(purpose: Purpose, kind: 'availability' | 'call'): string | undefined {
  const queue = state().faults?.[purpose];
  const head = queue?.[0];
  if (head === undefined) return undefined;
  const isAvailability = head.startsWith('availability:');
  if ((kind === 'availability') !== isAvailability) return undefined;
  queue?.shift();
  return head;
}

function textOf(parts: SdkPart[]): string {
  return parts.flatMap((p) => ('text' in p ? [p.text] : [])).join('\n');
}

function sourceFor(spec: ModelSpec): 'on_device' | 'in_cloud' {
  if (spec.mode === 'ONLY_IN_CLOUD' || spec.mode === 'PREFER_IN_CLOUD') return 'in_cloud';
  return nano() === 'available' ? 'on_device' : 'in_cloud';
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

function aiError(code: string, status: string | undefined): Error {
  const e = new Error(`AI: e2e fault (AI/${code})`) as Error & { code: string; customErrorData?: { status: number } };
  e.name = 'FirebaseError';
  e.code = code;
  if (status) e.customErrorData = { status: Number(status) };
  return e;
}

function labelReply(prompt: string): string {
  const labels: { i: number; c: string }[] = [];
  for (const block of prompt.split(/\n\n(?=Item \d+\n)/)) {
    const head = /^Item (\d+)\n/.exec(block);
    if (!head) continue;
    const field = (name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(block)?.[1] ?? '';
    const kind = (field('Kind') || 'email') as 'email' | 'document' | 'photo' | 'note';
    labels.push({
      i: Number(head[1]),
      c: codeLabel({ kind, from: field('From') || undefined, title: field('Subject') || field('File'), preview: field('Preview') || field('Description') }).category,
    });
  }
  return JSON.stringify({ labels });
}

function selectReply(prompt: string, recordIds: string[], fault: string | undefined): string {
  const question = /^Question: (.*)$/m.exec(prompt)?.[1]?.toLowerCase() ?? '';
  const entry = (state().answers ?? []).find((a) => question.includes(a.match.toLowerCase()));
  let item = 'P1';
  if (entry?.recordId === null) {
    item = 'none';   // like Nano when none of the allowed items answers the question
  } else if (entry?.recordId) {
    const i = recordIds.indexOf(entry.recordId);
    if (i >= 0) item = `P${i + 1}`;
  }
  let answer = entry?.answer;
  if (!answer) {
    const passage = /P1\n[\s\S]*?<<<\n([\s\S]*?)\n>>>/.exec(prompt)?.[1] ?? '';
    answer = (passage.replace(/^\[\.\.\.\]\s*/, '').match(/[^.!?]+[.!?]/)?.[0] ?? passage).trim().slice(0, 200);
  }
  if (fault?.startsWith('item:')) item = fault.slice(5);
  if (fault?.startsWith('answer:')) answer = fault.slice(7);
  return JSON.stringify({ item, answer: item === 'none' ? '' : answer });
}

/** The check of the answer against the item: true unless the canned entry or a fault says false. */
function verifyReply(prompt: string, fault: string | undefined): string {
  const question = /^Question: (.*)$/m.exec(prompt)?.[1]?.toLowerCase() ?? '';
  const entry = (state().answers ?? []).find((a) => question.includes(a.match.toLowerCase()));
  const answers = fault === 'answers:false' ? false : (entry?.verify ?? true);
  return JSON.stringify({ answers, reason: answers ? 'The passage states the answer.' : 'The passage does not answer the question.' });
}

function reply(spec: ModelSpec, prompt: string, recordIds: string[], fault: string | undefined): string {
  if (fault === 'bad-json') return 'not json';
  switch (spec.purpose) {
    case 'label':
      return labelReply(prompt);
    case 'select-answer':
      return selectReply(prompt, recordIds, fault);
    case 'verify-answer':
      return verifyReply(prompt, fault);
    case 'search-words':
      return JSON.stringify({ words: [] });
    case 'caption':
      return JSON.stringify({ caption: FIXED_CAPTION });
    case 'draft': {
      const approved = /<<<\n([\s\S]*?)\n>>>/.exec(prompt)?.[1] ?? '';
      return `Draft: ${approved}`;
    }
    case 'injection-check': {
      const canaries = (state().canaries ?? DEFAULT_CANARIES).map((c) => c.toLowerCase());
      const sentence = prompt.split(/(?<=[.!?])\s+/).find((s) => canaries.some((c) => s.toLowerCase().includes(c)));
      return JSON.stringify(sentence ? { suspicious: true, quote: sentence.trim() } : { suspicious: false, quote: '' });
    }
    case 'pii-check':
      return JSON.stringify({ items: [] });
  }
}

async function call(spec: ModelSpec, parts: SdkPart[], signal: AbortSignal, recordIds: string[]): Promise<ModelCallResult> {
  const fault = nextFault(spec.purpose, 'call');
  if (fault === 'hang') return waitForAbort(signal);
  if (fault === 'hang-while-hidden' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return waitForAbort(signal);
  if (fault?.startsWith('throw:')) throw new DOMException('e2e fault', fault.slice(6));
  if (fault?.startsWith('ai-error:')) {
    const [, code, status] = fault.split(':');
    throw aiError(code, status);
  }
  const source = sourceFor(spec);
  const prompt = textOf(parts);
  const calls = state().calls;
  const last = calls?.[calls.length - 1];
  if (last && last.purpose === spec.purpose && last.sdkReported === undefined) last.sdkReported = source;
  return { text: reply(spec, prompt, recordIds, fault), source };
}

export function createE2EHybrid(): HybridCaller {
  return {
    generate: (spec, parts, opts) => call(spec, parts, opts.signal, opts.meta?.recordIds ?? []),
    async stream(spec, parts, opts) {
      const result = await call(spec, parts, opts.signal, opts.meta?.recordIds ?? []);
      const pieces = [result.text.slice(0, Math.ceil(result.text.length / 3)), result.text.slice(Math.ceil(result.text.length / 3))];
      let soFar = '';
      for (const piece of pieces) {
        soFar += piece;
        opts.onText(soFar);
      }
      return result;
    },
  };
}

export function installE2EModel(): E2EHooks {
  state();
  return {
    hybrid: createE2EHybrid(),
    availabilityFault(purpose) {
      const fault = nextFault(purpose, 'availability');
      const value = fault?.slice('availability:'.length);
      return value && AVAILABILITY_STATES.has(value) ? (value as NanoAvailability) : undefined;
    },
  };
}
