// AT-PII-1 (gated: 100% of expected spans with the right type, 0 mustNotFlag hits) and the persona emails measured
// with plain code only (reported: names in body text are the browser model's and Nano's job).
import { beforeAll, describe, expect, test } from 'vitest';
import { detectPii } from '../pii/detect';
import { isProtectedValue } from '../pii/protected';
import { luhn } from '../pii/validators/card';
import { isValidIban } from '../pii/validators/iban';
import { isValidAba } from '../pii/validators/account';
import { isValidSsn } from '../pii/validators/ssn';
import { covers, formatScores, locate, noModel, overlapsAny, PII_FORMAT_CASES, PII_PERSONA_CASES, scoreSpans } from './helpers';

beforeAll(() => noModel());

describe('validator format cases (AT-PII-1)', () => {
  const results: { id: string; ok: boolean }[] = [];
  test.each(PII_FORMAT_CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const { spans } = await detectPii(c.text, 'own', { stages: c.stages ?? ['validators'] });
    for (const e of c.expect) {
      const at = locate(c.text, e.match, e.occurrence);
      expect(covers(spans, at.start, at.end, e.type), `${e.type} "${e.match}" in ${JSON.stringify(spans)}`).toBe(true);
      expect(spans.some((s) => s.start <= at.start && at.end <= s.end && s.by === 'validator')).toBe(true);
    }
    for (const m of c.mustNotFlag ?? []) {
      const at = locate(c.text, m);
      expect(overlapsAny(spans, at.start, at.end), `"${m}" must not be flagged: ${JSON.stringify(spans)}`).toBe(false);
    }
    results.push({ id: c.id, ok: true });
  });
  test('report', () => {
    const expected = PII_FORMAT_CASES.reduce((n, c) => n + c.expect.length, 0);
    const negatives = PII_FORMAT_CASES.reduce((n, c) => n + (c.mustNotFlag?.length ?? 0), 0);
    console.log(`validator format cases: ${results.length}/${PII_FORMAT_CASES.length} pass (${expected} expected spans found, 0 of ${negatives} must-not-flag values flagged)`);
    expect(results).toHaveLength(PII_FORMAT_CASES.length);
  });
});

describe('persona emails, plain code only (reported)', () => {
  test('precision and recall per type', async () => {
    const cases = [];
    for (const c of PII_PERSONA_CASES) {
      const { spans } = await detectPii(c.text, 'own', { stages: ['validators'] });
      cases.push({ text: c.text, gold: c.expect, predicted: spans });
    }
    console.log(formatScores('persona emails, validators only (names in body text are left to the model and Nano):', scoreSpans(cases)));
    const byType = new Map(scoreSpans(cases).map((s) => [s.type, s]));
    for (const t of ['phone', 'email', 'card', 'account', 'dob'] as const) expect(byType.get(t)?.recall).toBe(1);
  });
});

describe('checksums and protected values', () => {
  test('Luhn, IBAN mod 97, ABA, SSN ranges', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
    expect(isValidIban('GB82WEST12345698765433')).toBe(false);
    expect(isValidIban('GB82WEST1234569876543')).toBe(false);
    expect(isValidAba('021000021')).toBe(true);
    expect(isValidAba('123456789')).toBe(false);
    expect(isValidSsn('472', '81', '0094')).toBe(true);
    expect(isValidSsn('900', '12', '3456')).toBe(false);
  });
  test('money, dates, times, percentages, years and short numbers are protected', () => {
    for (const v of ['$1,200', '€45', '(USD 30)', '1,200 dollars', '03/03', '2026-03-03', 'March 3', '3 March 2026', 'Mar 3, 2026', '7:45 AM', '15%', '2026', '14']) {
      expect(isProtectedValue(v), v).toBe(true);
    }
    for (const v of ['Dana', 'K7Q2LM', '4111 1111 1111 1111', '14C']) expect(isProtectedValue(v), v).toBe(false);
  });
});
