// 70 section 3.5, R-PLAT-02 to R-PLAT-04: resume, visible, online, clock jumps, merging, discard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onWake, WAKE_GAP_MS, WAKE_MERGE_MS, WAKE_TICK_MS, wasDiscarded, type Wake } from './lifecycle';

let wakes: Wake[];
let off: () => void;

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-16T10:00:00Z'));
  wakes = [];
  off = onWake((w) => wakes.push(w));
});

afterEach(() => {
  off();
  vi.useRealTimers();
  setVisibility('visible');
  delete (document as Document & { wasDiscarded?: boolean }).wasDiscarded;
});

describe('onWake', () => {
  it('resume, visible and online each wake once', () => {
    document.dispatchEvent(new Event('resume'));
    vi.advanceTimersByTime(WAKE_MERGE_MS + 1);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(WAKE_MERGE_MS + 1);
    window.dispatchEvent(new Event('online'));
    expect(wakes.map((w) => w.reason)).toEqual(['resume', 'visible', 'online']);
  });

  it('hiding the tab is not a wake', () => {
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(wakes).toEqual([]);
  });

  it('wakes within 2 s are merged into one call', () => {
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('online'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(wakes).toHaveLength(1);
  });

  it('a tick that arrives more than 90 s late is a clock jump with its gap', () => {
    vi.advanceTimersByTime(WAKE_TICK_MS);
    expect(wakes).toEqual([]);
    // the laptop sleeps for 3 hours: the clock moves on, no timer fires in between
    vi.setSystemTime(Date.now() + 3 * 3_600_000);
    vi.advanceTimersByTime(WAKE_TICK_MS);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.reason).toBe('clock-jump');
    expect(wakes[0]?.gapMs).toBeGreaterThan(WAKE_GAP_MS);
  });

  it('a hidden tab ticking once a minute is not a clock jump', () => {
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(Date.now() + 60_000 - WAKE_TICK_MS);
      vi.advanceTimersByTime(WAKE_TICK_MS);
    }
    expect(wakes).toEqual([]);
  });

  it('one shared set of listeners; the last unsubscribe removes them', () => {
    const more: Wake[] = [];
    const off2 = onWake((w) => more.push(w));
    window.dispatchEvent(new Event('online'));
    expect(wakes).toHaveLength(1);
    expect(more).toHaveLength(1);
    off2();
    off();
    vi.advanceTimersByTime(WAKE_MERGE_MS + 1);
    window.dispatchEvent(new Event('online'));
    expect(wakes).toHaveLength(1);
    off = onWake((w) => wakes.push(w));
  });

  it('a throwing subscriber does not stop the others', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const off2 = onWake(() => {
      throw new Error('boom');
    });
    window.dispatchEvent(new Event('online'));
    expect(wakes).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith('wake handler', 'Error');
    off2();
    errors.mockRestore();
  });
});

describe('wasDiscarded (R-PLAT-02)', () => {
  it('reads document.wasDiscarded', () => {
    expect(wasDiscarded()).toBe(false);
    Object.defineProperty(document, 'wasDiscarded', { configurable: true, value: true });
    expect(wasDiscarded()).toBe(true);
  });
});
