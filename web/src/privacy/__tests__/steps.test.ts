// step-cases.json (AT-STEP-1 to AT-STEP-12 and more) and AT-STEP-13. Every record ships a current scan, so no model runs.
import type { LadderStep } from '@sieve/shared';
import { MAX_PAYLOAD_CHARS } from '@sieve/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { setPrivacyModelHost } from '../model/client';
import { clearScanMemo } from '../scan/scan';
import { buildStepOption } from '../steps/build';
import { locateExcerpt } from '../steps/excerpt';
import { isWellFormed } from '../text';
import { privacyWarnings } from '../warnings';
import { STEP_CASES, toRecord } from './helpers';

const ai = vi.hoisted(() => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));
vi.mock('../../ai', () => ai);

beforeEach(() => {
  clearScanMemo();
  setPrivacyModelHost(null);
  ai.runModel.mockReset().mockImplementation(async (args: { purpose: string }) => ({
    ok: true,
    value: args.purpose === 'pii-check' ? { items: [] } : { suspicious: false, quote: '' },
    trace: { kind: 'pii', label: 'x', where: 'device', sdkReported: 'on_device', modeRequested: 'ONLY_ON_DEVICE', ms: 5, charsSent: 0, at: 0 },
  }));
  ai.getNanoAvailability.mockReset().mockResolvedValue({ text: 'available', image: 'available' });
});

describe('step-cases.json', () => {
  const rows = STEP_CASES.flatMap((c) => (Object.keys(c.expect) as LadderStep[]).map((step) => [`${c.id} ${step}`, c, step] as const));
  test.each(rows)('%s', async (_name, c, step) => {
    const e = c.expect[step]!;
    const option = await buildStepOption(step, c.parts, toRecord(c.record), 'own', c.opts ?? {});
    expect(option.available, option.unavailableReason).toBe(e.available);
    if (e.reason) expect(option.unavailableReason).toBe(e.reason);
    if (e.text !== undefined) expect(option.text).toBe(e.text);
    for (const s of e.contains ?? []) expect(option.text).toContain(s);
    for (const s of e.notContains ?? []) expect(option.text).not.toContain(s);
    if (e.startsWith) expect(option.text.startsWith(e.startsWith), option.text.slice(0, 200)).toBe(true);
    if (e.endsWith) expect(option.text.endsWith(e.endsWith)).toBe(true);
    if (e.maxChars) expect(option.chars).toBeLessThanOrEqual(e.maxChars);
    if (e.redactions !== undefined) expect(option.redactions).toBe(e.redactions);
    expect(option.chars).toBe(option.text.length);
    expect(option.chars).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
    expect(isWellFormed(option.text)).toBe(true);
    if (!option.available) expect(option).toMatchObject({ text: '', chars: 0, redactions: 0 });
    expect(ai.runModel).not.toHaveBeenCalled();
  });
});

describe('buildStepOption details', () => {
  const landlord = () => toRecord(STEP_CASES[0]!.record);

  test('AT-STEP-13 a stale scan runs once for three parallel steps; onScanned once per call with the same patch', async () => {
    const stale = { ...landlord(), privacyScan: { ...landlord().privacyScan!, textHash: 'old' } };
    const onScanned = vi.fn();
    const parts = { answer: 'Your deposit was $1,200, paid on March 3.', excerpt: 'We received your security deposit of $1,200 on March 3.' };
    const options = await Promise.all((['answer', 'excerpt', 'full'] as const).map((step) => buildStepOption(step, parts, stale, 'own', { onScanned })));
    expect(options.every((o) => o.available)).toBe(true);
    expect(onScanned).toHaveBeenCalledTimes(3);
    const patches = onScanned.mock.calls.map(([p]) => p);
    expect(patches[1]).toBe(patches[0]);
    expect(patches[2]).toBe(patches[0]);
    expect(ai.runModel).not.toHaveBeenCalled();                        // the scan runs no Gemini Nano (11 section 6.1)
  });

  test('a stale scan at question time (allowNano false) makes no model call', async () => {
    const stale = { ...landlord(), privacyScan: undefined };
    const option = await buildStepOption('full', {}, stale, 'own', { allowNano: false });
    expect(option.available).toBe(true);
    expect(ai.runModel).not.toHaveBeenCalled();
  });

  test('the answer is capped at 300 characters at a sentence end (00 D5)', async () => {
    const long = 'Your deposit was $1,200, paid on March 3. '.repeat(12);
    const option = await buildStepOption('answer', { answer: long }, landlord(), 'own');
    expect(option.chars).toBeLessThanOrEqual(300);
    expect(option.text.endsWith('.')).toBe(true);
  });

  test('each option says what plain code did', async () => {
    const option = await buildStepOption('full', {}, landlord(), 'own');
    expect(option.trace?.[0]).toMatchObject({ kind: 'pii', where: 'code', label: 'Plain code masked 3 personal details on this device' });
  });

  test('warnings for the options', async () => {
    const rec = landlord();
    const options = await Promise.all((['answer', 'excerpt', 'full'] as const).map((s) => buildStepOption(s, { answer: 'Your deposit was $1,200.', excerpt: 'We received your security deposit of $1,200 on March 3.' }, rec, 'own')));
    expect(privacyWarnings(rec, options).map((w) => w.kind)).toEqual(['pii-redacted']);
  });

  test('excerpt location never returns lines that are not in the item (R-OUT-03)', () => {
    const text = STEP_CASES[0]!.record.text as string;
    for (const ex of ['We received your security deposit of $1,200 on March 3.', '"It will be returned within 30 days of move-out..."', 'They got the $1,200 deposit on March 3', 'Let me know your move-out date ... schedule the inspection.']) {
      const at = locateExcerpt(text, ex);
      expect(at, ex).not.toBeNull();
      expect(text.includes(text.slice(at!.start, at!.end))).toBe(true);
      expect(at!.end).toBeGreaterThan(at!.start);
    }
  });
});
