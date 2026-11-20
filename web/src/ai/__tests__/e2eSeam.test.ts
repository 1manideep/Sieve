import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNanoAvailability } from '../device/availability';
import { downloadNano } from '../device/setup';
import { SELECT_SCHEMA } from '../prompts';
import { runModel } from '../runModel';
import { selectAndAnswer } from '../tasks/select';
import { resetAiForTests } from '../testing/reset';
import { RECORDS } from './fixtures';

describe('the e2e model seam (60 section 3.9.1, 70 section 15.4)', () => {
  beforeEach(() => {
    resetAiForTests();
    vi.stubEnv('VITE_SIEVE_E2E', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__sieveE2E;
    resetAiForTests();
  });

  it('reads availability from window.__sieveE2E and records every model call', async () => {
    window.__sieveE2E = { nano: 'available', calls: [], answers: [{ match: 'deposit', recordId: 'playground:deposit', answer: 'Your deposit was $1,200, paid on March 3.' }] };
    expect(await getNanoAvailability({ maxAgeMs: 0 })).toEqual({ text: 'available', image: 'available' });
    const res = await selectAndAnswer('What did my landlord say about the deposit?', [RECORDS.flight, RECORDS.deposit], 'sample');
    expect(res.ok && res.value.recordId).toBe('playground:deposit');
    expect(res.trace).toMatchObject({ where: 'device', sdkReported: 'on_device' });
    expect(window.__sieveE2E.calls?.[0]).toMatchObject({ purpose: 'select-answer', mode: 'PREFER_ON_DEVICE', data: 'sample', recordIds: ['playground:flight', 'playground:deposit'] });
  });

  it('without Nano: sample data runs "in the cloud", own data is stopped', async () => {
    window.__sieveE2E = { nano: 'unavailable', calls: [] };
    const sample = await selectAndAnswer('deposit', [RECORDS.deposit], 'sample');
    expect(sample.trace).toMatchObject({ where: 'cloud', sdkReported: 'in_cloud', modeRequested: 'ONLY_IN_CLOUD' });
    const own = await selectAndAnswer('deposit', [{ ...RECORDS.deposit, source: 'upload', id: 'upload:x' }], 'own');
    expect(!own.ok && own.error.code).toBe('unavailable');
    expect(window.__sieveE2E.calls).toHaveLength(1);
  });

  it('consumes faults one per call', async () => {
    window.__sieveE2E = { nano: 'available', faults: { 'select-answer': ['bad-json', 'item:none'], draft: ['ai-error:fetch-error:429'], label: ['availability:downloading'] } };
    const first = await runModel({ purpose: 'select-answer', mode: 'PREFER_ON_DEVICE', data: 'sample', prompt: 'Question: x\n\nP1\n<<<\nHello.\n>>>', schema: SELECT_SCHEMA });
    expect(first.ok && first.value).toEqual({ item: 'none', answer: '' });
    const draft = await runModel({ purpose: 'draft', mode: 'PREFER_IN_CLOUD', data: 'approved', prompt: 'Instruction: x\n\nApproved text:\n<<<\nHi.\n>>>' });
    expect(!draft.ok && draft.error.code).toBe('quota');
    const label = await runModel({ purpose: 'label', mode: 'ONLY_ON_DEVICE', data: 'own', prompt: 'x' });
    expect(!label.ok && label.error.code).toBe('downloading');
    const draft2 = await runModel<string>({ purpose: 'draft', mode: 'PREFER_IN_CLOUD', data: 'approved', prompt: 'Instruction: x\n\nApproved text:\n<<<\nHi.\n>>>' });
    expect(draft2.ok && draft2.value).toBe('Draft: Hi.');
  });

  it('a hang fault waits until the timeout', async () => {
    window.__sieveE2E = { nano: 'available', faults: { 'select-answer': ['hang'] } };
    const res = await runModel({ purpose: 'select-answer', mode: 'PREFER_ON_DEVICE', data: 'sample', prompt: 'x', schema: SELECT_SCHEMA, timeoutMs: 30 });
    expect(!res.ok && res.error.code).toBe('timeout');
  });

  it('downloadNano reports progress and marks the model ready', async () => {
    window.__sieveE2E = { nano: 'downloadable' };
    const fractions: number[] = [];
    await downloadNano({ onProgress: (f) => fractions.push(f) });
    expect(fractions).toEqual([0.25, 0.5, 1]);
    expect(await getNanoAvailability()).toEqual({ text: 'available', image: 'available' });
  });
});
