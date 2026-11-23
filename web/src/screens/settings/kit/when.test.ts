// The time left on a timer, as the auto-approve pill says it.
import { describe, expect, it } from 'vitest';
import { formatLeft } from './when';

describe('formatLeft', () => {
  it('says hours and minutes, to the nearest minute, and never less than one', () => {
    expect(formatLeft(2 * 3_600_000)).toBe('2 h');
    expect(formatLeft(72 * 60_000)).toBe('1 h 12 min');
    expect(formatLeft(18 * 60_000 - 1)).toBe('18 min');
    expect(formatLeft(2 * 3_600_000 + 20_000)).toBe('2 h');
    expect(formatLeft(5_000)).toBe('1 min');
    expect(formatLeft(-1)).toBe('1 min');
  });
});
