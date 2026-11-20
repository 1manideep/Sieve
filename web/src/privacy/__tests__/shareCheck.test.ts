// The share-time Gemini Nano check (11 section 10.7): AT-SHARE-1 to AT-SHARE-7, and AT-SCAN-8 (never two model
// calls in flight), which moved here with the Nano calls.
import type { IndexRecord, LadderStep, StepOption } from '@sieve/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { REMOVED_SENTENCE } from '../constants';
import { setPrivacyModelHost } from '../model/client';
import { clearScanMemo } from '../scan/scan';
import { buildStepOption } from '../steps/build';
import { checkOutgoing, outgoingForCheck, type ShareCheckedRecord } from '../steps/shareCheck';
import { privacyWarnings } from '../warnings';
import { STEP_CASES, toRecord } from './helpers';

const ai = vi.hoisted(() => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));
vi.mock('../../ai', () => ai);

const FLAGGED = 'Let me know your move-out date so we can schedule the inspection.';
const parts = { answer: 'Your deposit was $1,200, paid on March 3.', excerpt: 'We received your security deposit of $1,200 on March 3.' };
const landlord = (): IndexRecord => toRecord(STEP_CASES[0]!.record);
const trace = (where: 'device' | 'cloud') => ({
  kind: 'pii', label: 'x', where, modeRequested: 'ONLY_ON_DEVICE', sdkReported: where === 'device' ? 'on_device' : 'in_cloud', model: 'gemini-nano', ms: 40, charsSent: 0, at: 0,
});

let findName: string | null;
let flag: string | null;

async function allSteps(rec: IndexRecord, extra: { extraEntities?: never[] } | Record<string, unknown> = {}, maxStep: LadderStep = 'full'): Promise<StepOption[]> {
  return Promise.all((['answer', 'excerpt', 'full'] as const).map((step) => buildStepOption(step, parts, rec, 'own', { allowNano: false, maxStep, ...extra })));
}

beforeEach(() => {
  clearScanMemo();
  setPrivacyModelHost(null);
  findName = null;
  flag = null;
  ai.runModel.mockReset().mockImplementation(async (args: { purpose: string; prompt: string }) => {
    if (args.purpose === 'pii-check') {
      return { ok: true, value: { items: findName && args.prompt.includes(findName) ? [{ text: findName, type: 'name' }] : [] }, trace: trace('device') };
    }
    return { ok: true, value: flag ? { suspicious: true, quote: flag } : { suspicious: false, quote: '' }, trace: { ...trace('device'), kind: 'injection' } };
  });
  ai.getNanoAvailability.mockReset().mockResolvedValue({ text: 'available', image: 'available' });
});

describe('checkOutgoing', () => {
  test('AT-SHARE-1 one injection-check and one pii-check, in the foreground, on the device, on the text that would leave', async () => {
    const rec = landlord();
    const options = await allSteps(rec);
    const full = options.find((o) => o.step === 'full')!;
    const started: string[] = [];
    const check = await checkOutgoing(rec, 'own', options, parts, { onStart: (kind, where) => started.push(`${kind}:${where}`) });
    expect(ai.runModel.mock.calls.map(([a]) => a.purpose)).toEqual(['injection-check', 'pii-check']);
    for (const [args] of ai.runModel.mock.calls) {
      expect(args).toMatchObject({ mode: 'ONLY_ON_DEVICE', priority: 'foreground', recordIds: [rec.id] });
      expect(args.prompt).toBe(full.text);                               // exactly the outgoing text, nothing else
    }
    expect(started).toEqual(['injection:device', 'pii:device']);
    expect(check.trace.map((t) => [t.kind, t.where])).toEqual([['injection', 'device'], ['pii', 'device']]);
    expect(check.trace.map((t) => t.label)).toEqual(['No hidden instructions in the text to share', 'No more personal details in the text to share']);
    expect(check).toMatchObject({ entities: [], quotes: [], nanoPii: true, ran: 2 });
    expect(check.shareChecks).toHaveLength(1);
    expect(check.shareChecks![0]!.key).toBe(`${rec.contentHash}|${rec.privacyScan!.textHash}|full`);
  });

  test('AT-SHARE-2 the result is cached on the record: a second approve of the same text makes no call', async () => {
    findName = 'Oakview Property Management';
    const rec = landlord();
    const first = await checkOutgoing(rec, 'own', await allSteps(rec), parts);
    const cachedRec: ShareCheckedRecord = { ...rec, shareChecks: first.shareChecks };
    ai.runModel.mockClear();
    const again = await checkOutgoing(cachedRec, 'own', await allSteps(cachedRec), parts);
    expect(ai.runModel).not.toHaveBeenCalled();
    expect(again).toMatchObject({ ran: 0, nanoPii: true, entities: first.entities });
    expect(again.shareChecks).toBeUndefined();                            // nothing new to save
    expect(again.trace.every((t) => t.where === 'code' && !t.charsSent)).toBe(true);
    expect(again.trace[1]!.label).toBe('This exact text was checked before: 1 name masked');
    // another range (only the excerpt may leave) is another text: it is checked once more
    const excerptOnly = await checkOutgoing(cachedRec, 'own', await allSteps(cachedRec, {}, 'excerpt'), parts);
    expect(excerptOnly.ran).toBe(2);
    expect(excerptOnly.shareChecks!.map((c) => c.key.split('|')[2])).toEqual([expect.stringMatching(/^excerpt:\d+-\d+$/), 'full']);
  });

  test('AT-SHARE-3 findings are applied with the existing rules: names masked in every step, the flagged sentence removed', async () => {
    findName = 'Oakview Property Management';
    flag = FLAGGED;
    const rec = landlord();
    const options = await allSteps(rec);
    expect(options.find((o) => o.step === 'full')!.text).toContain('Oakview Property Management');
    const check = await checkOutgoing(rec, 'own', options, parts);
    expect(check.entities).toEqual([{ text: 'Oakview Property Management', type: 'name', by: 'nano' }]);
    expect(check.quotes).toEqual([FLAGGED]);
    expect(check.trace.map((t) => t.label)).toEqual([
      'Found a sentence aimed at an AI in the text to share, so Sieve keeps it out',
      'Found and masked 1 name in the text to share',
    ]);
    const rebuilt = await allSteps(rec, { extraEntities: check.entities, extraQuotes: check.quotes });
    const full = rebuilt.find((o) => o.step === 'full')!;
    expect(full.text).not.toContain('Oakview Property Management');
    expect(full.text).not.toContain(FLAGGED);
    expect(full.text).toContain(REMOVED_SENTENCE);
    expect(full.redactions).toBeGreaterThan(options.find((o) => o.step === 'full')!.redactions);
    expect(rebuilt.find((o) => o.step === 'answer')!.text).toBe(parts.answer);
  });

  test('AT-SHARE-4 Nano unavailable: no call, the rows say the check was skipped, and the limited-check warning stays honest', async () => {
    ai.getNanoAvailability.mockResolvedValue({ text: 'unavailable', image: 'unavailable' });
    const rec = landlord();
    const options = await allSteps(rec);
    const check = await checkOutgoing(rec, 'own', options, parts);
    expect(ai.runModel).not.toHaveBeenCalled();
    expect(check).toMatchObject({ entities: [], quotes: [], nanoPii: false, ran: 0 });
    expect(check.shareChecks).toBeUndefined();
    expect(check.trace.map((t) => t.where)).toEqual(['code', 'code']);
    expect(check.trace[0]!.label).toMatch(/^Gemini Nano is not available, so this check was skipped\./);
    const noModel = { ...rec, privacyScan: { ...rec.privacyScan!, pii: { validators: rec.privacyScan!.pii.validators } } };
    expect(privacyWarnings(noModel, options, { nanoPii: check.nanoPii }).map((w) => w.kind)).toContain('pii-check-limited');
    expect(privacyWarnings(noModel, options, { nanoPii: true }).map((w) => w.kind)).not.toContain('pii-check-limited');
  });

  test('AT-SHARE-5 sample data without Nano: the injection check may use the cloud (as before); personal details stay on the device', async () => {
    ai.getNanoAvailability.mockResolvedValue({ text: 'unavailable', image: 'unavailable' });
    ai.runModel.mockImplementation(async () => ({ ok: true, value: { suspicious: false, quote: '' }, trace: { ...trace('cloud'), kind: 'injection', charsSent: 300 } }));
    const rec = landlord();
    const started: string[] = [];
    const check = await checkOutgoing(rec, 'sample', await allSteps(rec), parts, { onStart: (kind, where) => started.push(`${kind}:${where}`) });
    expect(ai.runModel.mock.calls.map(([a]) => [a.purpose, a.mode])).toEqual([['injection-check', 'PREFER_ON_DEVICE']]);
    expect(started).toEqual(['injection:cloud', 'pii:code']);
    expect(check.trace[0]).toMatchObject({ where: 'cloud', charsSent: 300 });
    expect(check.nanoPii).toBe(false);
  });

  test('AT-SHARE-6 only what may leave is read: an answer-only grant checks the answer text alone', async () => {
    const rec = landlord();
    const options = await allSteps(rec, {}, 'answer');
    await checkOutgoing(rec, 'own', options, parts);
    expect(ai.runModel.mock.calls.map(([a]) => a.prompt)).toEqual([parts.answer, parts.answer]);
    expect(outgoingForCheck([], parts, rec)).toBeNull();
  });

  test('AT-SHARE-7 the excerpt is added when the full text was cut before it', () => {
    const rec = landlord();
    const options: StepOption[] = [
      { step: 'answer', text: 'A.', chars: 2, redactions: 0, available: true },
      { step: 'excerpt', text: 'Lines from an email (Mar 3, 2026):\nThe last line.', chars: 48, redactions: 0, available: true },
      { step: 'full', text: 'Email from Dana\n\nThe first line.', chars: 31, redactions: 0, available: true },
    ];
    const out = outgoingForCheck(options, { ...parts, excerpt: 'The last line.' }, rec)!;
    expect(out.text).toBe(`${options[2]!.text}\n\n${options[1]!.text}`);
    expect(out.range).toMatch(/^full\+excerpt:/);
  });

  test('AT-SCAN-8 never two model calls in flight', async () => {
    let inFlight = 0;
    let max = 0;
    ai.runModel.mockImplementation(async (args: { purpose: string }) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return args.purpose === 'pii-check' ? { ok: true, value: { items: [] }, trace: trace('device') } : { ok: true, value: { suspicious: false, quote: '' }, trace: trace('device') };
    });
    const rec = landlord();
    await checkOutgoing(rec, 'own', await allSteps(rec), parts);
    expect(ai.runModel).toHaveBeenCalledTimes(2);
    expect(max).toBe(1);
  });
});
