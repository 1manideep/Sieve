// AT-PII-2 to AT-PII-9: stage orchestration with runModel and the model host mocked.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { setPrivacyModelHost } from '../model/client';
import { detectPii } from '../pii/detect';
import { PII_CHECK_SYSTEM } from '../pii/nano';
import { PII_CHECK_SCHEMA } from '../schemas';
import { fakeModelHost, modelSpansFor } from './helpers';

const ai = vi.hoisted(() => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));
vi.mock('../../ai', () => ai);

const nanoTrace = { kind: 'pii', label: 'x', where: 'device', modeRequested: 'ONLY_ON_DEVICE', sdkReported: 'on_device', model: 'gemini-nano', ms: 40, charsSent: 0, at: 0 };
const nanoOk = (items: { text: string; type: string }[]) => ({ ok: true, value: { items }, trace: nanoTrace });
const nanoErr = (code: string) => ({ ok: false, error: { code, message: code }, trace: { ...nanoTrace, sdkReported: undefined } });

beforeEach(() => {
  ai.runModel.mockReset();
  ai.getNanoAvailability.mockReset().mockResolvedValue({ text: 'available', image: 'available' });
  setPrivacyModelHost(fakeModelHost(() => []));
});

describe('detectPii', () => {
  test('AT-PII-2 validators only', async () => {
    const text = 'Hi Dana, your deposit of $1,200 was received on March 3. Call (312) 555-0142. Best, Dana';
    const { spans, trace } = await detectPii(text, 'sample', { stages: ['validators'] });
    const values = spans.map((s) => [text.slice(s.start, s.end), s.type]);
    expect(values).toEqual([['Dana', 'name'], ['(312) 555-0142', 'phone'], ['Dana', 'name']]);
    expect(trace).toHaveLength(1);
    expect(trace[0]!.where).toBe('code');
    expect(ai.runModel).not.toHaveBeenCalled();
  });

  test('AT-PII-3 model labels: names kept, city dropped, protected money dropped', async () => {
    const text = 'Priya Nair moved to Seattle and paid $1,200.';
    setPrivacyModelHost(fakeModelHost((t) => modelSpansFor(t, [
      { match: 'Priya', label: 'GIVEN_NAME', score: 0.9 }, { match: 'Nair', label: 'SURNAME', score: 0.8 },
      { match: 'Seattle', label: 'CITY', score: 0.9 }, { match: '$1,200', label: 'BANK_ACCOUNT', score: 0.5 },
    ])));
    const { spans, trace } = await detectPii(text, 'own', { stages: ['validators', 'model'] });
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['Priya', 'Nair']);
    expect(spans.every((s) => s.type === 'name' && s.by === 'model')).toBe(true);
    expect(trace[1]).toMatchObject({ where: 'device', model: 'Rampart (WASM)', label: 'The privacy model on this device found 2 names' });
  });

  test('AT-PII-4 model failed: skipped with the right label; validators and Nano still run', async () => {
    setPrivacyModelHost(fakeModelHost(() => [], { fail: true }));
    ai.runModel.mockResolvedValue(nanoOk([]));
    const { trace } = await detectPii('Hi Dana, call (312) 555-0142.', 'own');
    expect(trace.map((t) => t.label)).toEqual([
      'Plain code found 1 phone number, 1 name',
      'The privacy model could not load on this device, so this check was skipped',
      'Gemini Nano on this device found nothing more',
    ]);
    expect(ai.runModel).toHaveBeenCalledTimes(1);
  });

  test('AT-PII-5 Nano strings are located; strings not in the text are dropped', async () => {
    ai.runModel.mockResolvedValue(nanoOk([{ text: 'Jordan', type: 'name' }, { text: 'Nobody Here', type: 'name' }]));
    const text = 'See you Saturday, Jordan said.';
    const { spans } = await detectPii(text, 'own');
    expect(spans).toEqual([{ start: 18, end: 24, type: 'name', by: 'nano' }]);
  });

  test('AT-PII-6 Nano unavailable: skipped with the right label, no throw', async () => {
    ai.runModel.mockResolvedValue(nanoErr('unavailable'));
    const { trace } = await detectPii('See you Saturday, Jordan said.', 'own');
    expect(trace[2]!.label).toBe('Gemini Nano is not available on this device, so the last check was skipped');
  });

  test('AT-PII-7 too-long once: the halves are checked, exactly 3 calls', async () => {
    const text = 'Lunch with Jordan Ellis on Friday was fun. Then Priya Nair joined us for coffee.';
    ai.runModel
      .mockResolvedValueOnce(nanoErr('too-long'))
      .mockResolvedValueOnce(nanoOk([{ text: 'Jordan Ellis', type: 'name' }]))
      .mockResolvedValueOnce(nanoOk([{ text: 'Priya Nair', type: 'name' }]));
    const { spans } = await detectPii(text, 'own');
    expect(ai.runModel).toHaveBeenCalledTimes(3);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['Jordan Ellis', 'Priya Nair']);
  });

  test('AT-PII-8 pii-check runs on the device for every data class, with the fixed prompt and schema', async () => {
    ai.runModel.mockResolvedValue(nanoOk([]));
    for (const data of ['own', 'sample', 'approved'] as const) await detectPii('Lunch with Jordan.', data);
    expect(ai.runModel).toHaveBeenCalledTimes(3);
    for (const [args] of ai.runModel.mock.calls) {
      expect(args).toMatchObject({ purpose: 'pii-check', mode: 'ONLY_ON_DEVICE', system: PII_CHECK_SYSTEM, schema: PII_CHECK_SCHEMA });
      expect(typeof args.prompt).toBe('string');
      expect(args.data).not.toBe('approved');
    }
  });

  test('Nano sees earlier finds masked', async () => {
    ai.runModel.mockResolvedValue(nanoOk([]));
    await detectPii('Hi Dana, call (312) 555-0142 about the lease.', 'own');
    expect(ai.runModel.mock.calls[0]![0].prompt).toBe('Hi [name], call [phone] about the lease.');
  });

  test('AT-PII-9 propagation: a found full name also hides a later first name', async () => {
    const text = 'Dana Lee signed. Later, Dana called.';
    setPrivacyModelHost(fakeModelHost((t) => modelSpansFor(t, [{ match: 'Dana Lee', label: 'GIVEN_NAME', score: 0.9 }])));
    const { spans } = await detectPii(text, 'own', { stages: ['validators', 'model'] });
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['Dana Lee', 'Dana']);
  });

  test('known entities are located', async () => {
    const { spans } = await detectPii('Ask Priya about it.', 'own', { stages: ['validators'], known: [{ text: 'Priya', type: 'name', by: 'model', score: 0.9 }] });
    expect(spans).toEqual([{ start: 4, end: 9, type: 'name', by: 'model', score: 0.9 }]);
  });

  test('allowNano false skips the Nano stage entirely', async () => {
    const { trace } = await detectPii('Lunch with Jordan.', 'own', { allowNano: false });
    expect(trace).toHaveLength(2);
    expect(ai.runModel).not.toHaveBeenCalled();
  });

  test('an abort throws an AbortError', async () => {
    const c = new AbortController();
    c.abort();
    await expect(detectPii('x', 'own', { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a throwing AI layer is a skipped stage, not a throw', async () => {
    ai.runModel.mockImplementation(() => {
      throw new Error('Not built yet: ai');
    });
    const { trace } = await detectPii('Lunch with Jordan.', 'own');
    expect(trace[2]!.where).toBe('code');
  });
});
