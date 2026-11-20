import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the error table is checked against the SDK's real AIError (10 RM-12)
import { AIError } from 'firebase/ai';
import { mapError } from '../errors';

const ctx = { mode: 'PREFER_ON_DEVICE' as const, timedOut: false, callerAborted: false };

describe('mapError (10 section 9.6, RM-12)', () => {
  it('maps the SDK and Prompt API failures to codes and messages', () => {
    const cases: [unknown, string, string][] = [
      [new AIError('fetch-error', 'x', { status: 429 }), 'quota', 'The cloud model is busy or over its free quota. Try again in a minute.'],
      [new AIError('fetch-error', 'x', { status: 403 }), 'app-check', "This copy of Sieve couldn't prove it is the real app (App Check)."],
      [new AIError('fetch-error', 'x', { status: 500 }), 'unknown', 'The cloud model had a problem (500). Try again.'],
      [new DOMException('x', 'QuotaExceededError'), 'too-long', 'The prompt was too long for the on-device model.'],
      [new DOMException('x', 'NotAllowedError'), 'downloading', 'Click anywhere in the Sieve tab to start the on-device model.'],
      [new AIError('unsupported', 'x'), 'unavailable', 'This Chrome has no on-device model.'],
      [new AIError('response-error', 'x'), 'bad-output', 'The model gave no usable answer.'],
      [new TypeError('Failed to fetch'), 'unknown', "Couldn't reach the cloud model. Check your connection."],
    ];
    for (const [e, code, message] of cases) {
      expect(mapError(e, ctx)).toMatchObject({ code, message });
    }
  });

  it('checks the caller abort and the timeout first', () => {
    expect(mapError(new AIError('unsupported', 'x'), { ...ctx, callerAborted: true })).toMatchObject({ code: 'aborted' });
    expect(mapError(new DOMException('x', 'AbortError'), { ...ctx, timedOut: true, timeoutMs: 45000 })).toMatchObject({
      code: 'timeout', message: 'The model took too long (over 45 seconds).',
    });
    expect(mapError(new DOMException('Preempted', 'AbortError'), ctx)).toMatchObject({ code: 'aborted' });
  });

  it('covers the remaining rows', () => {
    expect(mapError(new DOMException('x', 'NotSupportedError'), ctx).code).toBe('unavailable');
    expect(mapError(new DOMException('x', 'InvalidStateError'), ctx)).toMatchObject({ code: 'unknown', message: 'The on-device session closed. Try again.' });
    expect(mapError(new AIError('api-not-enabled', 'x'), { ...ctx, mode: 'ONLY_ON_DEVICE' }).code).toBe('unavailable');
    expect(mapError(new AIError('api-not-enabled', 'x'), ctx)).toMatchObject({ code: 'unknown', message: 'Firebase AI Logic is not enabled for this project.' });
    expect(mapError(new AIError('error', 'App Check token fetch failed'), ctx).code).toBe('app-check');
    expect(mapError(new AIError('error', 'Error fetching from x: Failed to fetch'), ctx).message).toBe("Couldn't reach the cloud model. Check your connection.");
    expect(mapError(new AIError('no-api-key', 'x'), ctx).message).toBe("Sieve's AI setup is incomplete (no-api-key).");
    expect(mapError(new Error('?'), ctx)).toMatchObject({ code: 'unknown', message: 'Something went wrong with the model.' });
  });
});
