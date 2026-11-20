// Model faults for Vitest pipeline tests (70 section 15.4): the same fault names as the e2e seam
// (window.__sieveE2E.faults, web/src/ai/testing/fakeModel.ts), behind a mocked runModel. A queue per purpose, one
// fault consumed per call; no fault means the scripted reply (or `fallback`) succeeds.
//
//   vi.mock('@/ai/runModel', () => ({ runModel: faults.runModel }))
//   faults.push('select-answer', 'hang', 'answer:Your deposit was $1,500.')
import type { TraceStep } from '@sieve/shared';
import type { ModelErrorCode, Purpose, RunModelArgs, RunModelResult } from '../../web/src/ai/types';

export type FaultName = 'hang' | 'hang-while-hidden' | 'bad-json' | `throw:${string}` | `ai-error:${string}:${string}` | `item:${string}` | `answer:${string}` | `availability:${string}`;

export interface ModelCallLog { purpose: Purpose; data: string; prompt: string; recordIds: string[]; fault?: string; outcome: 'ok' | ModelErrorCode }

/** DOMException names to 10's codes (web/src/ai/errors.ts mapError), for 'throw:<name>' faults. */
const THROW_CODES: Record<string, ModelErrorCode> = {
  TimeoutError: 'timeout', AbortError: 'aborted', QuotaExceededError: 'too-long', NotSupportedError: 'unavailable',
  NotAllowedError: 'downloading', InvalidStateError: 'unknown',
};
/** 'ai-error:<code>:<status>' to 10's codes. */
function aiErrorCode(code: string, status: number): ModelErrorCode {
  if (code === 'fetch-error' && status === 429) return 'quota';
  if (code === 'fetch-error' && (status === 401 || status === 403)) return 'app-check';
  if (code === 'unsupported') return 'unavailable';
  if (code === 'response-error' || code === 'parse-failed' || code === 'invalid-content') return 'bad-output';
  return 'unknown';
}

function promptText(p: RunModelArgs['prompt']): string {
  return typeof p === 'string' ? p : p.map((x) => (x.type === 'text' ? x.text : '[image]')).join('\n');
}

export interface FaultyModel {
  /** Queue faults for a purpose, consumed in order. */
  push(purpose: Purpose, ...faults: FaultName[]): void;
  /** What every call received (prompt text included, for "never reaches the model" checks). */
  calls: ModelCallLog[];
  /** The availability a queued 'availability:<state>' fault set, if any. */
  availability?: string;
  runModel<T>(args: RunModelArgs): Promise<RunModelResult<T>>;
  reset(): void;
}

/**
 * `reply(args)` gives the successful value for a purpose (for select-answer, `{ item, answer }`); 'item:' and
 * 'answer:' faults override those two fields. `isHidden` drives 'hang-while-hidden'.
 */
export function createFaultyModel(reply: (args: RunModelArgs) => unknown, opts: { isHidden?: () => boolean; now?: () => number } = {}): FaultyModel {
  const queues = new Map<Purpose, string[]>();
  const now = opts.now ?? Date.now;
  const model: FaultyModel = {
    calls: [],
    push(purpose, ...faults) {
      queues.set(purpose, [...(queues.get(purpose) ?? []), ...faults]);
    },
    reset() {
      queues.clear();
      model.calls.length = 0;
      model.availability = undefined;
    },
    async runModel<T>(args: RunModelArgs): Promise<RunModelResult<T>> {
      const started = now();
      const fault = queues.get(args.purpose)?.shift();
      const trace = (where: TraceStep['where']): TraceStep => ({ kind: 'select', label: 'fake model', where, ms: Math.max(0, now() - started), at: started });
      const log = (outcome: ModelCallLog['outcome']) => model.calls.push({ purpose: args.purpose, data: args.data, prompt: promptText(args.prompt), recordIds: args.recordIds ?? [], ...(fault ? { fault } : {}), outcome });
      const fail = (code: ModelErrorCode, message: string): RunModelResult<T> => {
        log(code);
        return { ok: false, error: { code, message }, trace: trace('device') };
      };
      if (fault?.startsWith('availability:')) {
        model.availability = fault.slice('availability:'.length);
        return fail('unavailable', 'The on-device model is not available.');
      }
      if (fault === 'hang' || (fault === 'hang-while-hidden' && opts.isHidden?.())) {
        await new Promise<void>((resolve) => {
          if (args.signal?.aborted) resolve();
          args.signal?.addEventListener('abort', () => resolve(), { once: true });
          if (args.timeoutMs) setTimeout(resolve, args.timeoutMs);
        });
        return args.signal?.aborted ? fail('aborted', 'Stopped.') : fail('timeout', 'The model took too long.');
      }
      if (fault?.startsWith('throw:')) return fail(THROW_CODES[fault.slice(6)] ?? 'unknown', `The model failed (${fault.slice(6)}).`);
      if (fault?.startsWith('ai-error:')) {
        const [, code = '', status = '0'] = fault.split(':');
        return fail(aiErrorCode(code, Number(status)), `The model failed (${code}).`);
      }
      if (fault === 'bad-json') return fail('bad-output', 'The model gave no usable answer.');
      let value = reply(args);
      if (fault?.startsWith('item:') || fault?.startsWith('answer:')) {
        const base = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        value = fault.startsWith('item:') ? { ...base, item: fault.slice(5) } : { ...base, answer: fault.slice(7) };
      }
      log('ok');
      return { ok: true, value: value as T, trace: trace('device') };
    },
  };
  return model;
}
