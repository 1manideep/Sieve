// The only outbound call of this module (11 principle P1): runModel with purpose pii-check or injection-check.
// A throw from the AI layer becomes an error result; an abort becomes an AbortError.
import type { DataClass, InferenceModeName, TraceStep } from '@sieve/shared';
import { runModel, type ModelErrorCode, type RunModelArgs, type RunModelResult } from '../ai';
import { abortError } from './text';

/** RunModelArgs plus the optional fields 10 section 9.1 adds (dataChars, label, validate). */
export interface PrivacyModelArgs extends RunModelArgs {
  purpose: 'pii-check' | 'injection-check';
  dataChars?: number;
  label?: string;
  validate?: (value: unknown) => unknown;
}

export type ModelOutcome<T> =
  | { ok: true; value: T; trace: TraceStep }
  | { ok: false; code: ModelErrorCode; message: string; trace: TraceStep };

function fallbackTrace(args: { mode: InferenceModeName; purpose: PrivacyModelArgs['purpose'] }, message: string): TraceStep {
  return { kind: args.purpose === 'pii-check' ? 'pii' : 'injection', label: message, where: 'code', ms: 0, at: Date.now(), charsSent: 0 };
}

export async function callModel<T>(args: PrivacyModelArgs): Promise<ModelOutcome<T>> {
  if (args.signal?.aborted) throw abortError();
  let res: RunModelResult<T>;
  try {
    res = await runModel<T>(args);
  } catch (e) {
    if (args.signal?.aborted) throw abortError();
    const message = e instanceof Error ? e.message : 'The model could not run.';
    return { ok: false, code: 'unknown', message, trace: fallbackTrace(args, message) };
  }
  if (!res.ok) {
    if (res.error.code === 'aborted' || args.signal?.aborted) throw abortError();
    return { ok: false, code: res.error.code, message: res.error.message, trace: res.trace };
  }
  return { ok: true, value: res.value, trace: res.trace };
}

/** Own data and approved text are never sent to a cloud mode by this module. */
export function modelDataClass(data: DataClass): 'own' | 'sample' {
  return data === 'sample' ? 'sample' : 'own';
}
