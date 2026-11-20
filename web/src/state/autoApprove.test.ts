import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_APPROVE_KEY,
  AUTO_APPROVE_MS,
  AUTO_APPROVED_KEY,
  autoApproveOn,
  markAutoApproved,
  readAutoApprove,
  readAutoApproved,
  useAutoApprove,
} from './autoApprove';

const NOW = Date.UTC(2026, 10, 20, 15, 0, 0);
const stored = (uid = 'u1') => JSON.parse(window.localStorage.getItem(AUTO_APPROVE_KEY(uid)) ?? 'null') as unknown;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('auto-approve store (40 section 13.8.9)', () => {
  it('is off by default', () => {
    expect(readAutoApprove('u1')).toEqual({});
    expect(autoApproveOn('u1', 'g1')).toBe(false);
  });

  it('turns on for 2 hours, per account and connection', () => {
    const stop = useAutoApprove.getState().start('u1');
    useAutoApprove.getState().turnOn('g1');
    expect(useAutoApprove.getState().until).toEqual({ g1: NOW + AUTO_APPROVE_MS });
    expect(stored()).toEqual({ g1: NOW + AUTO_APPROVE_MS });
    expect(autoApproveOn('u1', 'g1')).toBe(true);
    expect(autoApproveOn('u1', 'g2')).toBe(false);
    expect(autoApproveOn('u2', 'g1')).toBe(false);
    stop();
  });

  it('expires after 2 hours: the entry is ignored, cleaned from storage and the store updates', () => {
    const stop = useAutoApprove.getState().start('u1');
    useAutoApprove.getState().turnOn('g1');
    vi.advanceTimersByTime(AUTO_APPROVE_MS - 1000);
    expect(autoApproveOn('u1', 'g1')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(useAutoApprove.getState().until).toEqual({});
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    expect(stored()).toEqual({});
    stop();
  });

  it('cleans expired, malformed and too-far entries and keeps the live ones', () => {
    window.localStorage.setItem(
      AUTO_APPROVE_KEY('u1'),
      JSON.stringify({ old: NOW - 1, bad: 'soon', far: NOW + 30 * 86_400_000, live: NOW + 60_000 }),
    );
    expect(readAutoApprove('u1')).toEqual({ live: NOW + 60_000 });
    expect(stored()).toEqual({ live: NOW + 60_000 });
    window.localStorage.setItem(AUTO_APPROVE_KEY('u1'), 'not json');
    expect(readAutoApprove('u1')).toEqual({});
    window.localStorage.setItem(AUTO_APPROVE_KEY('u1'), '[1,2]');
    expect(readAutoApprove('u1')).toEqual({});
    expect(stored()).toEqual({});
  });

  it('Stop turns it off at once and leaves the other connections on', () => {
    const stop = useAutoApprove.getState().start('u1');
    useAutoApprove.getState().turnOn('g1');
    useAutoApprove.getState().turnOn('g2');
    useAutoApprove.getState().turnOff('g1');
    expect(useAutoApprove.getState().until).toEqual({ g2: NOW + AUTO_APPROVE_MS });
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    expect(autoApproveOn('u1', 'g2')).toBe(true);
    stop();
    expect(useAutoApprove.getState().until).toEqual({});
  });

  it('follows another tab through the storage event', () => {
    const stop = useAutoApprove.getState().start('u1');
    window.localStorage.setItem(AUTO_APPROVE_KEY('u1'), JSON.stringify({ g9: NOW + 1000 }));
    window.dispatchEvent(new StorageEvent('storage', { key: AUTO_APPROVE_KEY('u1') }));
    expect(useAutoApprove.getState().until).toEqual({ g9: NOW + 1000 });
    stop();
  });

  it('stays off when the browser keeps nothing', () => {
    const stop = useAutoApprove.getState().start('u1');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    useAutoApprove.getState().turnOn('g1');
    expect(useAutoApprove.getState().until).toEqual({});
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    setItem.mockRestore();
    stop();
  });

  it('lists the receipts approved automatically, newest 1000, and can unmark one', () => {
    expect(readAutoApproved('u1').size).toBe(0);
    markAutoApproved('u1', 'r1');
    markAutoApproved('u1', 'r2');
    markAutoApproved('u1', 'r1', false);
    expect([...readAutoApproved('u1')]).toEqual(['r2']);
    for (let i = 0; i < 1005; i += 1) markAutoApproved('u1', `x${i}`);
    const ids = JSON.parse(window.localStorage.getItem(AUTO_APPROVED_KEY('u1'))!) as string[];
    expect(ids).toHaveLength(1000);
    expect(ids[ids.length - 1]).toBe('x1004');
    expect(readAutoApproved('u1').has('r2')).toBe(false);
  });
});
