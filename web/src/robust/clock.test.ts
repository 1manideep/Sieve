// 70 section 3.4 and R-PLAT-14: Google's time from .info/serverTimeOffset, trusted only for a minute or more.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ handlers: [] as ((snap: { val(): unknown }) => void)[], paths: [] as string[], unsubscribed: 0 }));

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string) => {
    db.paths.push(path);
    return { path };
  },
  onValue: (_ref: unknown, cb: (snap: { val(): unknown }) => void) => {
    db.handlers.push(cb);
    return () => {
      db.unsubscribed++;
    };
  },
}));

const { clockSkewMs, resetServerClockForTests, serverNow, setServerOffset, skewForBanner, startServerClock, subscribeSkew } = await import('./clock');
const { PLATFORM_COPY } = await import('./copy');

const emit = (v: unknown) => db.handlers.forEach((h) => h({ val: () => v }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-16T10:00:00Z'));
  db.handlers.length = 0;
  db.paths.length = 0;
  db.unsubscribed = 0;
  resetServerClockForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('server clock', () => {
  it('listens to .info/serverTimeOffset and stops', () => {
    const stop = startServerClock({} as never);
    expect(db.paths).toEqual(['.info/serverTimeOffset']);
    stop();
    expect(db.unsubscribed).toBe(1);
  });

  it('is Date.now() and unknown skew until the first offset', () => {
    expect(serverNow()).toBe(Date.now());
    expect(clockSkewMs()).toBeNull();
  });

  it('ignores offsets under a minute (latency), applies larger ones', () => {
    startServerClock({} as never);
    emit(30_000);
    expect(serverNow()).toBe(Date.now());
    expect(clockSkewMs()).toBe(-30_000);
    emit(-3 * 3_600_000);
    expect(serverNow()).toBe(Date.now() - 3 * 3_600_000);
    expect(clockSkewMs()).toBe(3 * 3_600_000);
  });

  it('a non-number value means unknown again', () => {
    setServerOffset(120_000);
    setServerOffset(null);
    expect(clockSkewMs()).toBeNull();
    expect(serverNow()).toBe(Date.now());
  });

  it('subscribers get the current skew, then every change', () => {
    const seen: (number | null)[] = [];
    const off = subscribeSkew((s) => seen.push(s));
    setServerOffset(-600_000);
    setServerOffset(-600_000);
    off();
    setServerOffset(0);
    expect(seen).toEqual([null, 600_000]);
  });
});

describe('R-PLAT-14 banner', () => {
  it('3 hours ahead (device clock 3 h ahead, RTDB offset -3 h)', () => {
    setServerOffset(-3 * 3_600_000);
    const b = skewForBanner();
    expect(b).toEqual({ amount: 3, unit: 'hours', direction: 'ahead' });
    expect(PLATFORM_COPY.clockSkew(b!.amount, b!.unit, b!.direction)).toBe(
      'Your computer\'s clock is 3 hours ahead. Sieve uses Google\'s time for requests, but dates like "yesterday" may be read wrong until you fix the clock.',
    );
  });

  it('minutes up to 120, hours above; nothing within 5 minutes', () => {
    expect(skewForBanner(-7 * 60_000)).toEqual({ amount: 7, unit: 'minutes', direction: 'behind' });
    expect(skewForBanner(120 * 60_000)).toEqual({ amount: 120, unit: 'minutes', direction: 'ahead' });
    expect(skewForBanner(121 * 60_000)).toEqual({ amount: 2, unit: 'hours', direction: 'ahead' });
    expect(skewForBanner(300_000)).toBeNull();
    expect(skewForBanner(null)).toBeNull();
  });

  it('a request expiring in 1 hour by server time is still open with the device 3 hours ahead', () => {
    setServerOffset(-3 * 3_600_000);
    const expireAt = serverNow() + 3_600_000;
    expect(serverNow() < expireAt).toBe(true);
    expect(Date.now() < expireAt).toBe(false);
  });
});
