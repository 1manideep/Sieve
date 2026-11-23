// "Today" in an answer is the item's day: the word gets its date when the item is not from today.
import { describe, expect, it } from 'vitest';
import { anchorRelativeDays } from './relativeDays';

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 11, 22, 15);
const ITEM = at(2026, 11, 6, 9);

describe('anchorRelativeDays', () => {
  it('writes the date for today, tomorrow, yesterday and tonight, counted from the item\'s day', () => {
    expect(anchorRelativeDays('The hot cocoa event is today from 10:30 AM to 12:00 PM.', ITEM, NOW)).toBe('The hot cocoa event is on November 6, 2026 from 10:30 AM to 12:00 PM.');
    expect(anchorRelativeDays('Late fees begin tomorrow.', ITEM, NOW)).toBe('Late fees begin on November 7, 2026.');
    expect(anchorRelativeDays('The parcel arrived yesterday.', ITEM, NOW)).toBe('The parcel arrived on November 5, 2026.');
    expect(anchorRelativeDays('Doors open tonight at 7 PM.', ITEM, NOW)).toBe('Doors open on the evening of November 6, 2026 at 7 PM.');
    expect(anchorRelativeDays('Today is the last day to renew.', ITEM, NOW)).toBe('November 6, 2026 is the last day to renew.');
    expect(anchorRelativeDays("Today's event starts at noon.", ITEM, NOW)).toBe('The November 6, 2026 event starts at noon.');
    // across a month and a year
    expect(anchorRelativeDays('It ends tomorrow.', at(2026, 12, 31), at(2027, 1, 20))).toBe('It ends on January 1, 2027.');
  });

  it('keeps a date the answer already gives, and drops only the word', () => {
    expect(anchorRelativeDays('Late fees begin tomorrow, November 5th.', at(2026, 11, 4), NOW)).toBe('Late fees begin November 5th.');
    expect(anchorRelativeDays('The event is today, Friday, Nov 6, at noon.', ITEM, NOW)).toBe('The event is Friday, Nov 6, at noon.');
  });

  it('changes nothing for an item from today, an item with no date, or an answer without those words', () => {
    const answer = 'Your card was declined today.';
    expect(anchorRelativeDays(answer, at(2026, 11, 22, 8), NOW)).toBe(answer);
    expect(anchorRelativeDays(answer, undefined, NOW)).toBe(answer);
    expect(anchorRelativeDays(answer, Number.NaN, NOW)).toBe(answer);
    expect(anchorRelativeDays('Your order total was $45.66.', ITEM, NOW)).toBe('Your order total was $45.66.');
    // not those words: "todays" inside another word, a hyphenated name
    expect(anchorRelativeDays('The Today-Show clip is attached.', ITEM, NOW)).toBe('The Today-Show clip is attached.');
  });
});
