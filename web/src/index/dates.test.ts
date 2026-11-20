// 20 section 9.3: A-PQ-2 (numeric dates), A-PQ-3 (periods and words with the Playground clock), A-PQ-5 (mentioned days).
import { describe, expect, it } from 'vitest';
import { PLAYGROUND_NOW } from './config';
import { dayFirst, mentionedDays, parseDates } from './dates';

process.env.TZ = 'America/Chicago';
const NOW = new Date(PLAYGROUND_NOW);

describe('numeric dates (A-PQ-2)', () => {
  it('reads 1-2-2026 by locale, flags it ambiguous, and flips on request', () => {
    expect(parseDates('emails from 1-2-2026', NOW, 'en-US')).toMatchObject({ after: '2026-01-02', before: '2026-01-02', interpreted: [{ text: '1-2-2026', as: '2026-01-02', ambiguous: true }] });
    expect(parseDates('emails from 1-2-2026', NOW, 'en-GB').after).toBe('2026-02-01');
    expect(parseDates('emails from 1-2-2026', NOW, 'en-US', ['1-2-2026']).after).toBe('2026-02-01');
  });

  it('uses the other order when the locale order is impossible, without ambiguity', () => {
    expect(parseDates('the receipt from 13/2/2026', NOW, 'en-US')).toMatchObject({ after: '2026-02-13', interpreted: [{ ambiguous: false }] });
  });

  it('money, times, decimals and phone numbers are not dates', () => {
    for (const q of ['the $1,200 deposit', 'flight at 7:45', 'version 3.5', 'call 555-0148']) expect(parseDates(q, NOW, 'en-US').interpreted).toEqual([]);
  });

  it('ISO dates and two-part dates with implied years', () => {
    expect(parseDates('the email on 2026-03-03', NOW, 'en-US').after).toBe('2026-03-03');
    expect(parseDates('the receipt from 12/04', NOW, 'en-US').after).toBe('2025-12-04');
  });

  it('dayFirst by locale', () => {
    expect(dayFirst('en-US')).toBe(false);
    expect(dayFirst('en-GB')).toBe(true);
    expect(dayFirst('de-DE')).toBe(true);
  });
});

describe('periods, ranges and word dates (A-PQ-3)', () => {
  const r = (q: string) => {
    const h = parseDates(q, NOW, 'en-US');
    return `${h.after}..${h.before}`;
  };
  it('matches the spec examples with now = PLAYGROUND_NOW', () => {
    expect(r('what did the doctor send last month')).toBe('2026-10-01..2026-10-31');
    expect(r('photos in July')).toBe('2026-07-01..2026-07-31');
    expect(r('last week')).toBe('2026-11-09..2026-11-15');
    expect(r('between march 1 and march 15')).toBe('2026-03-01..2026-03-15');
    expect(r('emails from Nov 28')).toBe('2025-11-28..2025-11-28');
    expect(r('when does my flight on Dec 4 leave')).toBe('2026-12-04..2026-12-04');
    expect(r('anything from 3 weeks ago')).toBe('2026-10-24..2026-10-30');
  });

  it('handles since, before, ranges with to, yesterday and holidays', () => {
    const since = parseDates('emails since September', NOW, 'en-US');
    expect(since.after).toBe('2026-09-01');
    expect(since.before).toBeUndefined();
    expect(parseDates('bills before Oct 3', NOW, 'en-US')).toMatchObject({ before: '2026-10-02' });
    expect(r('from Oct 3 to Oct 10')).toBe('2026-10-03..2026-10-10');
    expect(r('messages from yesterday')).toBe('2026-11-16..2026-11-16');
    expect(r('photos from the fourth of july')).toBe('2026-07-03..2026-07-05');
  });
});

describe('mentionedDays (A-PQ-5)', () => {
  it('reads the flight email of Nov 8 as December 4 and 6, 2026', () => {
    const text = 'Albatrine Air flight 1432 departs Chicago (ORD) on Friday, December 4 at 7:45 AM and arrives in Seattle (SEA) at 10:20 AM. Seat 14C.\nReturn: flight 1489 departs Seattle (SEA) on Sunday, December 6 at 6:10 PM.';
    const days = mentionedDays(text, Date.parse('2026-11-08T20:14:00-06:00'), 'en-US');
    expect(days).toContain('2026-12-04');
    expect(days).toContain('2026-12-06');
  });

  it('skips ambiguous numeric dates', () => {
    expect(mentionedDays('Meet on 3/4/2026 or on 2026-05-06.', Date.parse('2026-04-01T12:00:00-05:00'), 'en-US')).toEqual(['2026-05-06']);
  });
});
