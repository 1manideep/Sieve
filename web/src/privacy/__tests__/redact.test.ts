// AT-RED-1 to AT-RED-7 and the span edge cases of 70 R-OUT-01.
import type { PiiSpan } from '@sieve/shared';
import { describe, expect, test } from 'vitest';
import { locateEntities } from '../pii/locate';
import { mergeSpans } from '../pii/merge';
import { redact } from '../redact';
import { isWellFormed } from '../text';

const s = (text: string, match: string, type: PiiSpan['type'], occurrence = 1): PiiSpan => {
  let at = -1;
  for (let i = 0; i < occurrence; i++) at = text.indexOf(match, at + 1);
  return { start: at, end: at + match.length, type, by: 'validator' };
};

describe('redact (11 section 7.2)', () => {
  test('AT-RED-1 two names are numbered', () => {
    const t = 'Hi Alex, thanks. Best, Dana';
    expect(redact(t, [s(t, 'Alex', 'name'), s(t, 'Dana', 'name')])).toEqual({ text: 'Hi [name 1], thanks. Best, [name 2]', redactions: 2 });
  });
  test('AT-RED-2 a first name joins its full name', () => {
    const t = 'Dana Lee called. Dana said yes.';
    expect(redact(t, [s(t, 'Dana Lee', 'name'), s(t, 'Dana', 'name', 2)])).toEqual({ text: '[name] called. [name] said yes.', redactions: 2 });
  });
  test('AT-RED-3 cards show the last four digits', () => {
    const t = 'Card 4111 1111 1111 1111 was charged $45.00';
    expect(redact(t, [s(t, '4111 1111 1111 1111', 'card')])).toEqual({ text: 'Card [card ending 1111] was charged $45.00', redactions: 1 });
  });
  test('AT-RED-4 the same phone in two formats is one identity', () => {
    const t = 'Call (312) 555-0142 or 312.555.0142';
    expect(redact(t, [s(t, '(312) 555-0142', 'phone'), s(t, '312.555.0142', 'phone')])).toEqual({ text: 'Call [phone] or [phone]', redactions: 2 });
  });
  test('AT-RED-5 address parts join', () => {
    const t = '221 Oak Street, Apt 3B';
    expect(redact(t, [s(t, '221 Oak Street', 'address'), s(t, 'Apt 3B', 'address')])).toEqual({ text: '[address]', redactions: 1 });
  });
  test('AT-RED-6 no spans', () => expect(redact('no spans', [])).toEqual({ text: 'no spans', redactions: 0 }));
  test('AT-RED-7 keepTypes leaves a type in place', () => {
    const t = 'Call (312) 555-0142, Dana';
    expect(redact(t, [s(t, '(312) 555-0142', 'phone'), s(t, 'Dana', 'name')], { keepTypes: ['phone'] }).text).toBe('Call (312) 555-0142, [name]');
  });
  test('given and family name spans become one token', () => {
    const t = 'Priya Nair called.';
    expect(redact(t, [s(t, 'Priya', 'name'), s(t, 'Nair', 'name')])).toEqual({ text: '[name] called.', redactions: 1 });
  });
  test('accounts: last four for long numbers, plain for short ones, never numbered', () => {
    const t = 'Acct 000123456789 and acct 98765 and GB82 WEST 1234 5698 7654 32';
    const out = redact(t, [s(t, '000123456789', 'account'), s(t, '98765', 'account'), s(t, 'GB82 WEST 1234 5698 7654 32', 'iban')]).text;
    expect(out).toBe('Acct [account ending 6789] and acct [account] and [account ending 5432]');
  });
  test('other tokens', () => {
    const t = 'ssn 472-81-0094 dob 04/12/1990 id X1234567 mail a@b.example';
    const out = redact(t, [s(t, '472-81-0094', 'ssn'), s(t, '04/12/1990', 'dob'), s(t, 'X1234567', 'other'), s(t, 'a@b.example', 'email')]).text;
    expect(out).toBe('ssn [ssn] dob [date of birth] id [id number] mail [email]');
  });
  test('overlapping, adjacent, out-of-range, empty and end-of-text spans (R-OUT-01)', () => {
    const t = 'Dana Lee 312-555-0142';
    const spans: PiiSpan[] = [
      { start: 0, end: 4, type: 'name', by: 'model' }, { start: 2, end: 8, type: 'name', by: 'nano' },
      { start: 9, end: 21, type: 'phone', by: 'validator' }, { start: 15, end: 15, type: 'name', by: 'nano' },
      { start: 30, end: 40, type: 'name', by: 'nano' },
    ];
    expect(redact(t, spans)).toEqual({ text: '[name] [phone]', redactions: 2 });
  });
  test('spans inside a grapheme snap outward; the output stays well-formed', () => {
    const t = 'Hi 👨‍👩‍👧 Dana 🇮🇳';
    const out = redact(t, [{ start: 4, end: 6, type: 'other', by: 'nano' }, { start: t.indexOf('🇮🇳') + 1, end: t.length, type: 'other', by: 'nano' }]);
    expect(out.text).toBe('Hi [id number 1] Dana [id number 2]');
    expect(isWellFormed(out.text)).toBe(true);
  });
  test('a literal [name] stays as it is', () => expect(redact('Dear [name], hi', []).text).toBe('Dear [name], hi'));
});

describe('mergeSpans and locateEntities', () => {
  test('union of overlaps, highest type and by, best score', () => {
    expect(mergeSpans([
      { start: 0, end: 5, type: 'name', by: 'nano' },
      { start: 3, end: 9, type: 'phone', by: 'model', score: 0.4 },
      { start: 3, end: 9, type: 'phone', by: 'model', score: 0.7 },
      { start: 9, end: 12, type: 'name', by: 'nano' },
    ])).toEqual([{ start: 0, end: 9, type: 'phone', by: 'model', score: 0.7 }, { start: 9, end: 12, type: 'name', by: 'nano' }]);
  });
  test('names need a capital, digits match across separators, emails ignore case', () => {
    const t = 'dana and Dana; (312) 555-0142; dana@X.EXAMPLE; 4111-1111-1111-1111';
    const found = locateEntities(t, [
      { text: 'Dana', type: 'name', by: 'model' },
      { text: '3125550142', type: 'phone', by: 'validator' },
      { text: 'dana@x.example', type: 'email', by: 'validator' },
      { text: '4111 1111 1111 1111', type: 'card', by: 'validator' },
    ]);
    expect(found.map((f) => t.slice(f.start, f.end))).toEqual(['Dana', '(312) 555-0142', 'dana@X.EXAMPLE', '4111-1111-1111-1111']);
  });
});
