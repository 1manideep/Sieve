// AT-STEP-14 / AT-S7: a check that throws makes the step unavailable (fail closed).
import { beforeEach, expect, test, vi } from 'vitest';
import { setPrivacyModelHost } from '../model/client';
import { buildStepOption } from '../steps/build';
import { STEP_CASES, toRecord } from './helpers';

const ai = vi.hoisted(() => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));
vi.mock('../../ai', () => ai);
vi.mock('../redact', () => ({
  redact: () => {
    throw new Error('forced failure');
  },
}));

beforeEach(() => {
  setPrivacyModelHost(null);
  ai.getNanoAvailability.mockResolvedValue({ text: 'available', image: 'available' });
});

test('AT-STEP-14 redact throws: every step is unavailable with the S7 reason', async () => {
  const record = toRecord(STEP_CASES[0]!.record);
  for (const step of ['answer', 'excerpt', 'full'] as const) {
    const option = await buildStepOption(step, { answer: 'Your deposit was $1,200.', excerpt: 'We received your security deposit of $1,200 on March 3.' }, record, 'own');
    expect(option).toEqual({ step, text: '', chars: 0, redactions: 0, available: false, unavailableReason: 'Could not check this text for personal details.' });
  }
});
