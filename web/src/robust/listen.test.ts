// 70 section 3.6 and R-PLAT-13: listeners that come back.
import type { FirestoreError } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resilientSnapshot, type ListenState } from './listen';

interface Sub { next: () => void; error: (e: FirestoreError) => void; closed: boolean }

let subs: Sub[];
let states: ListenState[];
const err = (code: string) => ({ code, name: 'FirebaseError', message: 'x' }) as unknown as FirestoreError;

function subscribe(next: () => void, error: (e: FirestoreError) => void) {
  const s: Sub = { next, error, closed: false };
  subs.push(s);
  return () => {
    s.closed = true;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  subs = [];
  states = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const last = () => subs[subs.length - 1] as Sub;

describe('resilientSnapshot', () => {
  it('every next sets live', () => {
    const stop = resilientSnapshot('requests', subscribe, { onState: (s) => states.push(s) });
    last().next();
    last().next();
    expect(states).toEqual(['live']);
    stop();
  });

  it('unavailable: resubscribes after 1 s and is live again', () => {
    const stop = resilientSnapshot('requests', subscribe, { onState: (s) => states.push(s) });
    last().next();
    last().error(err('unavailable'));
    expect(states).toEqual(['live', 'retrying']);
    expect(subs[0]?.closed).toBe(true);
    vi.advanceTimersByTime(999);
    expect(subs).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(subs).toHaveLength(2);
    last().next();
    expect(states).toEqual(['live', 'retrying', 'live']);
    stop();
  });

  it('backs off 1, 2, 5, 10, 30, 30 s, and resets after 60 s live', () => {
    const stop = resilientSnapshot('requests', subscribe);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = subs.length;
      last().error(err('unavailable'));
      let waited = 0;
      while (subs.length === before) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 30_000]);
    last().next();
    vi.advanceTimersByTime(60_000);
    last().error(err('unavailable'));
    const before = subs.length;
    vi.advanceTimersByTime(1_000);
    expect(subs.length).toBe(before + 1);
    stop();
  });

  it('permission-denied with reauth true resubscribes once', async () => {
    const reauth = vi.fn(async () => true);
    const stop = resilientSnapshot('requests', subscribe, { onState: (s) => states.push(s), reauth });
    last().next();
    last().error(err('permission-denied'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(subs).toHaveLength(2);
    last().error(err('permission-denied'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(states[states.length - 1]).toBe('stopped');
    stop();
  });

  it('reauth false stops; no reauth stops', async () => {
    const stop = resilientSnapshot('requests', subscribe, { onState: (s) => states.push(s), reauth: async () => false });
    last().error(err('unauthenticated'));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(['retrying', 'stopped']);
    stop();
    states = [];
    const stop2 = resilientSnapshot('settings', subscribe, { onState: (s) => states.push(s) });
    last().error(err('permission-denied'));
    expect(states).toEqual(['stopped']);
    stop2();
  });

  it('a reauth that throws or rejects stops', async () => {
    const stop = resilientSnapshot('requests', subscribe, { onState: (s) => states.push(s), reauth: async () => Promise.reject(new Error('x')) });
    last().error(err('permission-denied'));
    await vi.advanceTimersByTimeAsync(0);
    expect(states[states.length - 1]).toBe('stopped');
    stop();
  });

  it('a subscribe that throws is retried like an error', () => {
    let calls = 0;
    const stop = resilientSnapshot('requests', (next, error) => {
      calls++;
      if (calls === 1) throw err('unavailable');
      return subscribe(next, error);
    }, { onState: (s) => states.push(s) });
    expect(states).toEqual(['retrying']);
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(2);
    stop();
  });

  it('an error delivered before subscribe returns still unsubscribes that listener', () => {
    const closed: boolean[] = [];
    const stop = resilientSnapshot('requests', (_next, error) => {
      error(err('unavailable'));
      return () => closed.push(true);
    });
    expect(closed).toEqual([true]);
    stop();
  });

  it('stop cancels the retry and ignores late callbacks', () => {
    const stop = resilientSnapshot('requests', subscribe, { onState: (s) => states.push(s) });
    const first = last();
    first.error(err('unavailable'));
    stop();
    vi.advanceTimersByTime(60_000);
    expect(subs).toHaveLength(1);
    first.next();
    expect(states).toEqual(['retrying']);
  });

  it('logs the name and the code only', () => {
    const stop = resilientSnapshot('requests', subscribe);
    last().error(err('unavailable'));
    expect(console.error).toHaveBeenCalledWith('requests listener', 'unavailable');
    stop();
  });
});
