import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirestoreError } from 'firebase/firestore';
import { resilientSnapshot, type ListenerState } from './resilient';

const err = (code: string) => ({ code, name: 'FirebaseError', message: code }) as unknown as FirestoreError;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('resilientSnapshot (70 section 3.6)', () => {
  it('resubscribes after an error with 1, 2, 5 s backoff', () => {
    const states: ListenerState[] = [];
    const handlers: { next: () => void; onError: (e: FirestoreError) => void }[] = [];
    const subscribe = vi.fn((next: () => void, onError: (e: FirestoreError) => void) => {
      handlers.push({ next, onError });
      return vi.fn();
    });
    resilientSnapshot('requests', subscribe, { onState: (s) => states.push(s) });
    handlers[0].next();
    handlers[0].onError(err('unavailable'));
    expect(states).toEqual(['live', 'retrying']);
    vi.advanceTimersByTime(999);
    expect(subscribe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    handlers[1].onError(err('internal'));
    vi.advanceTimersByTime(2000);
    expect(subscribe).toHaveBeenCalledTimes(3);
    handlers[2].onError(err('internal'));
    vi.advanceTimersByTime(4999);
    expect(subscribe).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(subscribe).toHaveBeenCalledTimes(4);
    handlers[3].next();
    expect(states.at(-1)).toBe('live');
  });

  it('permission errors refresh the token once, then stop', async () => {
    const states: ListenerState[] = [];
    const handlers: ((e: FirestoreError) => void)[] = [];
    const subscribe = vi.fn((_next: () => void, onError: (e: FirestoreError) => void) => {
      handlers.push(onError);
      return vi.fn();
    });
    const reauth = vi.fn(async () => true);
    resilientSnapshot('settings', subscribe, { onState: (s) => states.push(s), reauth });
    handlers[0](err('permission-denied'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    handlers[1](err('permission-denied'));
    expect(states.at(-1)).toBe('stopped');
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops retries', () => {
    const handlers: ((e: FirestoreError) => void)[] = [];
    const unsub = vi.fn();
    const subscribe = vi.fn((_n: () => void, onError: (e: FirestoreError) => void) => {
      handlers.push(onError);
      return unsub;
    });
    const stop = resilientSnapshot('x', subscribe);
    handlers[0](err('unavailable'));
    stop();
    vi.advanceTimersByTime(60_000);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
