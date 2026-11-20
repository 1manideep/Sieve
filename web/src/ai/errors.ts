// Error mapping (10 section 9.6). AIError is recognised by shape (a FirebaseError with an AI error code), so this file
// needs no runtime import of firebase/ai.
import type { InferenceModeName } from '@sieve/shared';
import type { ModelError } from './types';

const AI_CODES = new Set([
  'error', 'request-error', 'response-error', 'fetch-error', 'session-closed', 'invalid-content', 'api-not-enabled',
  'already-initialized', 'invalid-schema', 'no-api-key', 'no-app-id', 'no-model', 'no-project-id', 'parse-failed', 'unsupported',
]);

interface AIErrorLike {
  code: string;
  message: string;
  customErrorData?: { status?: number };
}

function nameOf(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : undefined;
}

function asAIError(e: unknown): AIErrorLike | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const x = e as { code?: unknown; message?: unknown; name?: unknown };
  if (typeof x.code !== 'string' || !AI_CODES.has(x.code)) return undefined;
  const message = typeof x.message === 'string' ? x.message : '';
  if (x.name !== 'FirebaseError' && !message.includes('(AI/')) return undefined;
  return e as AIErrorLike;
}

const MSG = {
  aborted: 'Stopped: the request was cancelled.',
  tooLong: 'The prompt was too long for the on-device model.',
  cantHandle: "The on-device model can't handle this input.",
  needsClick: 'Click anywhere in the Sieve tab to start the on-device model.',
  sessionClosed: 'The on-device session closed. Try again.',
  noDevice: 'This Chrome has no on-device model.',
  notEnabled: 'Firebase AI Logic is not enabled for this project.',
  quota: 'The cloud model is busy or over its free quota. Try again in a minute.',
  appCheck: "This copy of Sieve couldn't prove it is the real app (App Check).",
  badOutput: 'The model gave no usable answer.',
  offline: "Couldn't reach the cloud model. Check your connection.",
  generic: 'Something went wrong with the model.',
};

/**
 * A refusal from the cloud model that a retry cannot fix: an HTTP 4xx other than 429 (for example 400
 * FAILED_PRECONDITION "Firebase AI Logic genai config not found", or 403 from App Check). 429 is a busy model and
 * may be retried; 5xx and network failures are not refusals.
 */
export function isCloudRefusal(e: unknown): boolean {
  const ai = asAIError(e);
  if (!ai || ai.code !== 'fetch-error') return false;
  const status = ai.customErrorData?.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

export function mapError(
  e: unknown,
  ctx: { mode: InferenceModeName; timedOut: boolean; callerAborted: boolean; timeoutMs?: number },
): ModelError {
  const detail = import.meta.env.DEV && e instanceof Error ? e.message : undefined;
  const out = (code: ModelError['code'], message: string): ModelError => (detail ? { code, message, detail } : { code, message });
  const name = nameOf(e);

  if (ctx.callerAborted) return out('aborted', MSG.aborted);
  if (ctx.timedOut || name === 'TimeoutError') {
    const s = ctx.timeoutMs ? Math.round(ctx.timeoutMs / 1000) : undefined;
    return out('timeout', s ? `The model took too long (over ${s} seconds).` : 'The model took too long.');
  }
  if (name === 'AbortError') return out('aborted', MSG.aborted);
  if (name === 'QuotaExceededError') return out('too-long', MSG.tooLong);
  if (name === 'NotSupportedError') return out('unavailable', MSG.cantHandle);
  if (name === 'NotAllowedError') return out('downloading', MSG.needsClick);
  if (name === 'InvalidStateError') return out('unknown', MSG.sessionClosed);

  const ai = asAIError(e);
  if (ai) {
    switch (ai.code) {
      case 'unsupported':
        return out('unavailable', MSG.noDevice);
      case 'api-not-enabled':
        return ctx.mode === 'ONLY_ON_DEVICE' ? out('unavailable', MSG.noDevice) : out('unknown', MSG.notEnabled);
      case 'fetch-error': {
        const status = ai.customErrorData?.status;
        if (status === 429) return out('quota', MSG.quota);
        if (status === 401 || status === 403) return out('app-check', MSG.appCheck);
        if (status === undefined) return out('unknown', MSG.offline);
        return out('unknown', `The cloud model had a problem (${status}). Try again.`);
      }
      case 'response-error':
      case 'parse-failed':
      case 'invalid-content':
        return out('bad-output', MSG.badOutput);
      case 'error':
        if (ai.message.includes('App Check')) return out('app-check', MSG.appCheck);
        return out('unknown', MSG.offline);
      case 'no-api-key':
      case 'no-project-id':
      case 'no-app-id':
      case 'no-model':
      case 'invalid-schema':
        return out('unknown', `Sieve's AI setup is incomplete (${ai.code}).`);
      default:
        return out('unknown', MSG.generic);
    }
  }
  if (e instanceof TypeError && /failed to fetch/i.test(e.message)) return out('unknown', MSG.offline);
  return out('unknown', MSG.generic);
}
