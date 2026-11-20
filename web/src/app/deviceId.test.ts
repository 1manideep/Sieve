import { afterEach, describe, expect, it, vi } from 'vitest';
import { canKeepDeviceId, defaultDeviceLabel, getDeviceId, resetDeviceIdForTests } from './deviceId';

describe('getDeviceId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetDeviceIdForTests();
  });

  it('creates one id and keeps it in localStorage', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem('sieve.deviceId')).toBe(id);
    resetDeviceIdForTests();
    expect(getDeviceId()).toBe(id);
    expect(canKeepDeviceId()).toBe(true);
  });

  it('keeps the id in memory when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const id = getDeviceId();
    expect(getDeviceId()).toBe(id);
    expect(canKeepDeviceId()).toBe(false);
  });
});

describe('defaultDeviceLabel', () => {
  it.each([
    [{ userAgentData: { platform: 'macOS' }, userAgent: '' }, 'Chrome on Mac'],
    [{ userAgentData: { platform: 'Windows' }, userAgent: '' }, 'Chrome on Windows'],
    [{ userAgentData: { platform: 'Linux' }, userAgent: '' }, 'Chrome on Linux'],
    [{ userAgentData: { platform: 'Chrome OS' }, userAgent: '' }, 'Chrome on ChromeOS'],
    [{ userAgentData: { platform: 'Android' }, userAgent: '' }, 'This computer'],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/142.0' }, 'Chrome on Mac'],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0' }, 'Chrome on Windows'],
    [{ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 16181.0.0) Chrome/142.0' }, 'Chrome on ChromeOS'],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/142.0' }, 'Chrome on Linux'],
    [{ userAgent: 'Something else' }, 'This computer'],
  ])('%j gives %s', (nav, label) => {
    expect(defaultDeviceLabel(nav)).toBe(label);
  });
});
