// Presence teardown offline (40 section 10.7): Realtime Database writes never answer offline, so sign-out and Delete
// my account would wait for ever. Stop and removePresence give up after PRESENCE_TEARDOWN_MS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const never = () => new Promise<void>(() => undefined);
const calls: string[] = [];
vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  onValue: (_ref: unknown, cb: (snap: { val(): unknown }) => void) => {
    cb({ val: () => false });   // offline from the start
    return () => undefined;
  },
  onDisconnect: () => ({ set: never, cancel: () => (calls.push('cancel'), never()) }),
  set: () => (calls.push('set'), never()),
  remove: () => (calls.push('remove'), never()),
  serverTimestamp: () => 0,
}));
vi.mock('@/app/services/database', () => ({ rtdb: () => ({}) }));

const { PRESENCE_TEARDOWN_MS, removePresence, startPresence } = await import('./presence');

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('presence teardown offline', () => {
  it('stop() resolves within PRESENCE_TEARDOWN_MS when the writes never answer', async () => {
    const states: string[] = [];
    const handle = startPresence('u1', 'd1', (s) => states.push(s));
    expect(states).toEqual(['offline']);
    let done = false;
    void handle.stop().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(PRESENCE_TEARDOWN_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(calls).toEqual(['cancel']);
  });

  it('removePresence() resolves within PRESENCE_TEARDOWN_MS too', async () => {
    let done = false;
    void removePresence('u1', 'd1').then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(PRESENCE_TEARDOWN_MS);
    expect(done).toBe(true);
    expect(calls).toEqual(['remove']);
  });
});
