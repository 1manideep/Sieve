// privacyWarnings (11 section 11.1) and privacyTraceFor (11.3).
import type { IndexRecord, StepOption } from '@sieve/shared';
import { describe, expect, test } from 'vitest';
import { privacyTraceFor } from '../trace';
import { privacyWarnings } from '../warnings';

const base: IndexRecord = {
  id: 'gmail:1', source: 'gmail', sourceRef: '1', kind: 'email', title: 't', date: 0, preview: '', text: 'Hi Dana.', category: 'Home',
  categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: 0, contentHash: 'h', version: 1,
};
const st = (ran: 'code' | 'device' | 'cloud', ms = 10) => ({ version: 'v', ran, ms, at: 0 });
const opt = (redactions: number, available = true): StepOption => ({ step: 'full', text: 'x', chars: 1, redactions, available });

describe('privacyWarnings', () => {
  test('in order: hidden text, injection with a cut quote, redactions, limited check', () => {
    const rec: IndexRecord = { ...base, hiddenRemoved: ['a', 'b'], injection: { suspicious: true, quote: 'x'.repeat(300), by: 'code' } };
    const w = privacyWarnings(rec, [opt(2)]);
    expect(w.map((x) => x.kind)).toEqual(['hidden-text-removed', 'injection', 'pii-redacted', 'pii-check-limited']);
    expect(w[0]!.message).toBe('Sieve removed 2 pieces of hidden text from this item before any model read it.');
    expect(w[1]!.message.startsWith('This item has a sentence that looks like an instruction to an AI. Sieve keeps it out of what is shared. It says: "')).toBe(true);
    expect(w[1]!.message.length).toBeLessThan(260);
    expect(w[3]!.message).toBe('Names and addresses may not all be hidden: the on-device checks for them were not available.');
    for (const x of w) expect(x.message).not.toContain('\u2014');
  });
  test('no limited-check warning when the model or Nano ran; redactions only count on available options', () => {
    const rec: IndexRecord = { ...base, hiddenRemoved: ['one'], privacyScan: { textHash: 'h', pii: { model: st('device') }, injection: {}, headerEntities: [] } };
    expect(privacyWarnings(rec, [opt(3, false)]).map((x) => x.kind)).toEqual(['hidden-text-removed']);
    expect(privacyWarnings(rec, [])[0]!.message).toBe('Sieve removed 1 piece of hidden text from this item before any model read it.');
  });
});

describe('privacyTraceFor', () => {
  test('clean, pii and injection steps from the stamps', () => {
    const rec: IndexRecord = {
      ...base, hiddenRemoved: ['x'], pii: [{ start: 3, end: 7, type: 'name', by: 'model' }],
      injection: { suspicious: false, by: 'code' },
      privacyScan: { textHash: 'h', pii: { validators: st('code', 2), model: st('device', 30), nano: st('device', 4000) }, injection: { code: st('code', 1), nano: st('cloud', 3000) }, headerEntities: [] },
    };
    const [clean, pii, inj] = privacyTraceFor(rec);
    expect(clean).toMatchObject({ kind: 'clean', where: 'code', label: 'Plain code removed 1 piece of hidden text when this item was indexed' });
    expect(pii).toMatchObject({ kind: 'pii', where: 'device', ms: 4032, label: 'Personal details were checked when this item was indexed (plain code, the privacy model on this device and Gemini Nano on this device): 1 name' });
    expect(inj).toMatchObject({ kind: 'injection', where: 'cloud', label: 'No instructions aimed at an AI found (plain code and Gemini Nano) (when this item was indexed)' });
  });
  test('nothing stamped yet', () => {
    const [clean, pii, inj] = privacyTraceFor(base);
    expect(clean!.label).toBe('No hidden text found when this item was indexed');
    expect(pii!.where).toBe('code');
    expect(inj!.label).toBe('No instructions aimed at an AI found (plain code; Gemini Nano not used) (when this item was indexed)');
  });
});
