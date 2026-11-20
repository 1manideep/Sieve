import { describe, expect, it } from 'vitest';
import { formatCount, formatEta } from './format';
import * as strings from './strings';

/** Every string in strings.ts, with template functions called on sample values. */
function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown;
    const sample = Array.from({ length: fn.length }, (_, i) => (i === 0 ? 'Sample' : 3));
    try {
      return allStrings(fn(...sample));
    } catch {
      return allStrings(fn(['Sample', 'Other']));
    }
  }
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
}

describe('copy', () => {
  it('never uses an em dash or an en dash', () => {
    const all = allStrings(strings);
    expect(all.length).toBeGreaterThan(80);
    for (const s of all) {
      expect(s).not.toContain('—');
      expect(s).not.toContain('–');
    }
  });

  it('prefixes titles with the waiting count', () => {
    expect(strings.titleWithCount(strings.TITLES.ask, 0)).toBe('Ask · Sieve');
    expect(strings.titleWithCount(strings.TITLES.ask, 2)).toBe('(2) Ask · Sieve');
  });
});

describe('formatEta', () => {
  it.each([
    [10_000, 'less than a minute'],
    [59_000, 'less than a minute'],
    [5 * 60_000, '5 min'],
    [59 * 60_000, '59 min'],
    [75 * 60_000, '1 h 15 min'],
    [3 * 3_600_000, '3 h 0 min'],
  ])('%d ms is "%s"', (ms, text) => {
    expect(formatEta(ms)).toBe(text);
  });
});

describe('formatCount', () => {
  it('groups thousands the en-US way', () => {
    expect(formatCount(1412)).toBe('1,412');
  });
});
