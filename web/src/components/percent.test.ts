// Whole percents for the screen: 100 only when nothing is left, 0 only when nothing is done.
import { describe, expect, it } from 'vitest';
import { unfinishedPercent, wholePercent } from './percent';

describe('wholePercent', () => {
  it('is 100 only for all of it and 0 only for none of it', () => {
    expect(wholePercent(5675, 5675)).toBe(100);
    expect(wholePercent(5674, 5675)).toBe(99);
    expect(wholePercent(5637, 5675)).toBe(99);
    expect(wholePercent(1, 5675)).toBe(1);
    expect(wholePercent(0, 5675)).toBe(0);
    expect(wholePercent(50, 200)).toBe(25);
  });

  it('stays inside 0 to 100 for numbers that do not fit', () => {
    expect(wholePercent(9, 5)).toBe(100);
    expect(wholePercent(-3, 5)).toBe(0);
    expect(wholePercent(3, 0)).toBe(0);
    expect(wholePercent(Number.NaN, 5)).toBe(0);
  });
});

describe('unfinishedPercent', () => {
  it('never says 100 for work that is not finished', () => {
    expect(unfinishedPercent(0.996)).toBe(99);
    expect(unfinishedPercent(1)).toBe(99);
    expect(unfinishedPercent(0.5)).toBe(50);
    expect(unfinishedPercent(0.004)).toBe(0);
    expect(unfinishedPercent(0)).toBe(0);
    expect(unfinishedPercent(Number.NaN)).toBe(0);
  });
});
