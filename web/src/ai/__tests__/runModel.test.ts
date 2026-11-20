import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAvailabilityForTests } from '../device/availability';
import { setLanguageModelForTests } from '../device/languageModel';
import { setHybridForTests } from '../hybrid';
import { RETRY_REMINDER, SELECT_SCHEMA } from '../prompts';
import { getPolicyBreaches, runModel } from '../runModel';
import { createFakeHybrid, hang, type FakeHandler } from '../testing/fakeHybrid';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';
import type { RunModelArgs } from '../types';

const SELECT_JSON = '{"item":"P1","answer":"x"}';

function useNano(text: string, image = text) {
  setLanguageModelForTests(installFakeLanguageModel({ availability: { text, image } }));
}
function useHybrid(handler: FakeHandler) {
  const fake = createFakeHybrid(handler);
  setHybridForTests(fake);
  return fake;
}
const ownSelect = (over: Partial<RunModelArgs> = {}): RunModelArgs => ({
  purpose: 'select-answer', mode: 'ONLY_ON_DEVICE', data: 'own', prompt: 'Question: x', schema: SELECT_SCHEMA, ...over,
});

describe('runModel (10 section 16.3)', () => {
  beforeEach(() => resetAiForTests());

  it('RM-1: no API, own data: stopped before any model ran', async () => {
    setLanguageModelForTests(undefined);
    const fake = useHybrid(() => ({ text: SELECT_JSON, source: 'on_device' }));
    const res = await runModel(ownSelect());
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.code).toBe('unavailable');
    expect(fake.calls).toHaveLength(0);
    expect(res.trace).toMatchObject({ where: 'code', charsSent: 0 });
    expect(res.trace.sdkReported).toBeUndefined();
  });

  it('RM-2: an own-data call on the device is traced from the SDK report', async () => {
    useNano('available');
    useHybrid(() => ({ text: SELECT_JSON, source: 'on_device' }));
    const res = await runModel(ownSelect());
    expect(res.ok).toBe(true);
    expect(res.trace).toMatchObject({ where: 'device', sdkReported: 'on_device', model: 'gemini-nano', modeRequested: 'ONLY_ON_DEVICE', charsSent: 0 });
  });

  it('RM-3: the breach guard stops a cloud run of an on-device-only step', async () => {
    useNano('available');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useHybrid(() => ({ text: SELECT_JSON, source: 'in_cloud' }));
    const res = await runModel(ownSelect({ prompt: 'twelve chars', dataChars: 12 }));
    expect(!res.ok && res.error.code).toBe('cloud-not-allowed');
    expect(res.trace).toMatchObject({ where: 'cloud', sdkReported: 'in_cloud', charsSent: 12 });
    expect(getPolicyBreaches()).toHaveLength(1);
    errors.mockRestore();
  });

  it('RM-4: sample data without an API runs in the cloud, counted', async () => {
    setLanguageModelForTests(undefined);
    const fake = useHybrid(() => ({ text: SELECT_JSON, source: 'in_cloud' }));
    const res = await runModel(ownSelect({ data: 'sample', mode: 'PREFER_ON_DEVICE', prompt: 'abc', dataChars: 3 }));
    expect(res.ok).toBe(true);
    expect(res.trace).toMatchObject({ modeRequested: 'ONLY_IN_CLOUD', model: 'gemini-3.5-flash-lite', where: 'cloud', charsSent: 3 });
    expect(fake.calls[0].spec.mode).toBe('ONLY_IN_CLOUD');
  });

  it('RM-5: an invalid first reply is retried once with the reminder', async () => {
    useNano('available');
    const fake = useHybrid((_s, _p, { call }) => ({ text: call.n === 1 ? 'not json' : SELECT_JSON, source: 'on_device' }));
    const res = await runModel(ownSelect());
    expect(res.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
    const last = fake.calls[1].parts.at(-1);
    expect(last && 'text' in last && last.text.endsWith(RETRY_REMINDER)).toBe(true);
  });

  it('RM-6 and RM-7: two invalid replies, or validate rejecting twice, give bad-output', async () => {
    useNano('available');
    const fake = useHybrid(() => ({ text: '{"item":"P9"}', source: 'on_device' }));
    const res = await runModel(ownSelect());
    expect(!res.ok && res.error.code).toBe('bad-output');
    expect(fake.calls).toHaveLength(2);
    useHybrid(() => ({ text: SELECT_JSON, source: 'on_device' }));
    const res2 = await runModel(ownSelect({ validate: () => null }));
    expect(!res2.ok && res2.error.code).toBe('bad-output');
  });

  it('RM-8: a call that never resolves times out', async () => {
    useNano('available');
    useHybrid((_s, _p, { signal }) => hang(signal));
    const t0 = performance.now();
    const res = await runModel(ownSelect({ timeoutMs: 50 }));
    expect(!res.ok && res.error.code).toBe('timeout');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('RM-9: a signal aborted before the call sends nothing', async () => {
    useNano('available');
    const fake = useHybrid(() => ({ text: SELECT_JSON, source: 'on_device' }));
    const res = await runModel(ownSelect({ signal: AbortSignal.abort() }));
    expect(!res.ok && res.error.code).toBe('aborted');
    expect(res.trace.where).toBe('code');
    expect(fake.calls).toHaveLength(0);
  });

  it('RM-10: an abort during the call returns at once, even if the call ignores it', async () => {
    useNano('available');
    useHybrid(() => new Promise((r) => setTimeout(() => r({ text: SELECT_JSON, source: 'on_device' }), 1000)));
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    const t0 = performance.now();
    const res = await runModel(ownSelect({ signal: ctl.signal }));
    expect(!res.ok && res.error.code).toBe('aborted');
    expect(performance.now() - t0).toBeLessThan(20 + 50);
  });

  it('RM-11: an over-budget own-data prompt is refused before the call', async () => {
    useNano('available');
    const fake = useHybrid(() => ({ text: SELECT_JSON, source: 'on_device' }));
    const res = await runModel(ownSelect({ prompt: 'x'.repeat(30000) }));
    expect(!res.ok && res.error.code).toBe('too-long');
    expect(fake.calls).toHaveLength(0);
  });

  it('RM-13: streaming reports the raw prefixes, then parses the whole reply', async () => {
    useNano('available');
    useHybrid(() => ({
      text: '{"item":"P1","answer":"Your deposit was $1,200."}',
      chunks: ['{"item":"P1","answer":"Your dep', 'osit was $1,200."}'],
      source: 'on_device',
    }));
    const seen: string[] = [];
    const res = await runModel<{ item: string; answer: string }>(ownSelect({ onText: (s) => seen.push(s) }));
    expect(seen).toEqual(['{"item":"P1","answer":"Your dep', '{"item":"P1","answer":"Your deposit was $1,200."}']);
    expect(res.ok && res.value.answer).toBe('Your deposit was $1,200.');
  });

  it('RM-14: one user message per call, and no startChat anywhere in web/src', async () => {
    useNano('available');
    const fake = useHybrid(() => ({ text: SELECT_JSON, source: 'on_device' }));
    await runModel(ownSelect({ prompt: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }));
    expect(fake.calls[0].parts).toEqual([{ text: 'one' }, { text: 'two' }]);
    const root = join(process.cwd().endsWith('web') ? process.cwd() : join(process.cwd(), 'web'), 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && /\.startChat\b/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('own data with consent runs in the cloud and counts what left', async () => {
    useNano('unavailable');
    const { fakeDb } = await import('./fakeDb');
    const db = fakeDb({ consents: [{ recordId: 'upload:a', cloudAllowedAt: Date.now() }] });
    const fake = useHybrid(() => ({ text: SELECT_JSON, source: 'in_cloud' }));
    const res = await runModel(ownSelect({ prompt: 'abcd', dataChars: 4, recordIds: ['upload:a'], ownCloud: { allowed: true, db, maxAgeMs: null } }));
    expect(res.ok).toBe(true);
    expect(res.trace).toMatchObject({ where: 'cloud', modeRequested: 'ONLY_IN_CLOUD', charsSent: 4 });
    expect(fake.calls[0].meta).toMatchObject({ data: 'own', recordIds: ['upload:a'] });
    const without = await runModel(ownSelect({ recordIds: ['upload:b'], ownCloud: { allowed: true, db, maxAgeMs: null } }));
    expect(!without.ok && without.error.code).toBe('needs-consent');
    expect(fake.calls).toHaveLength(1);
  });

  it('maps thrown SDK errors, and counts a failed cloud try as sent', async () => {
    setLanguageModelForTests(undefined);
    useHybrid(() => {
      throw Object.assign(new Error('AI: x (AI/fetch-error)'), { name: 'FirebaseError', code: 'fetch-error', customErrorData: { status: 429 } });
    });
    const res = await runModel(ownSelect({ data: 'sample', mode: 'PREFER_ON_DEVICE', prompt: 'ab', dataChars: 2 }));
    expect(!res.ok && res.error.code).toBe('quota');
    expect(res.trace).toMatchObject({ where: 'cloud', charsSent: 2 });
    expect(res.trace.sdkReported).toBeUndefined();
  });
});

describe('cloud refusals: a 4xx other than 429 is never retried', () => {
  beforeEach(() => resetAiForTests());

  const refusal = (status: number) =>
    Object.assign(new Error(`AI: Error fetching [${status}] FAILED_PRECONDITION (AI/fetch-error)`), {
      name: 'FirebaseError', code: 'fetch-error', customErrorData: { status },
    });
  const INJECTION_JSON = '{"suspicious":false,"quote":""}';
  const sampleCheck = (over: Partial<RunModelArgs> = {}): RunModelArgs => ({
    purpose: 'injection-check', mode: 'PREFER_ON_DEVICE', data: 'sample', prompt: 'Sample email text', priority: 'background',
    schema: { type: 'object', properties: { suspicious: { type: 'boolean' }, quote: { type: 'string' } }, required: ['suspicious', 'quote'] },
    ...over,
  });

  it('a 400 FAILED_PRECONDITION makes one request, and later background calls of that purpose stop before the cloud', async () => {
    setLanguageModelForTests(undefined);
    const fake = useHybrid(() => {
      throw refusal(400);
    });
    const first = await runModel(sampleCheck());
    expect(!first.ok && first.error.code).toBe('unknown');
    expect(fake.calls).toHaveLength(1);                     // a schema call allows two tries; a refusal uses one
    // The Playground's privacy lane: one call per sample record on load. Only the first reaches the cloud.
    for (let i = 0; i < 41; i += 1) {
      const res = await runModel(sampleCheck({ prompt: `Sample email ${i}` }));
      expect(res.ok).toBe(false);
      expect(res.trace).toMatchObject({ where: 'code', charsSent: 0 });
    }
    expect(fake.calls).toHaveLength(1);
    // Another intent still tries once; a question the person asks tries again.
    await runModel(sampleCheck({ purpose: 'label' }));
    expect(fake.callsFor('label')).toHaveLength(1);
    await runModel(sampleCheck({ priority: 'foreground' }));
    expect(fake.callsFor('injection-check')).toHaveLength(2);
  });

  it('every 4xx but 429 counts; 429 and 5xx stay retryable', async () => {
    for (const status of [401, 403, 404]) {
      resetAiForTests();
      setLanguageModelForTests(undefined);
      const fake = useHybrid(() => {
        throw refusal(status);
      });
      await runModel(sampleCheck());
      await runModel(sampleCheck());
      expect(fake.calls).toHaveLength(1);
    }
    for (const status of [429, 500, 503]) {
      resetAiForTests();
      setLanguageModelForTests(undefined);
      const fake = useHybrid(() => {
        throw refusal(status);
      });
      await runModel(sampleCheck());
      await runModel(sampleCheck());
      expect(fake.calls).toHaveLength(2);
    }
  });

  it('when the cloud works, every call goes through as before, and a success clears a refusal', async () => {
    setLanguageModelForTests(undefined);
    let fail = true;
    const fake = useHybrid(() => {
      if (fail) throw refusal(400);
      return { text: INJECTION_JSON, source: 'in_cloud' };
    });
    await runModel(sampleCheck());
    fail = false;
    expect((await runModel(sampleCheck({ priority: 'foreground' }))).ok).toBe(true);
    for (let i = 0; i < 5; i += 1) expect((await runModel(sampleCheck({ prompt: `Sample email ${i}` }))).ok).toBe(true);
    expect(fake.calls).toHaveLength(7);
  });

  it('on the device nothing is blocked: the rule only stops cloud-only calls', async () => {
    setLanguageModelForTests(undefined);
    const fake = useHybrid(() => {
      throw refusal(400);
    });
    await runModel(sampleCheck());
    expect(fake.calls).toHaveLength(1);
    resetAvailabilityForTests();                             // Nano finished setting up
    useNano('available');
    const device = useHybrid(() => ({ text: INJECTION_JSON, source: 'on_device' }));
    const res = await runModel(sampleCheck());
    expect(device.calls).toHaveLength(1);
    expect(res.ok).toBe(true);
    expect(res.trace).toMatchObject({ where: 'device' });
  });
});

describe('the Playground load: one cloud request per intent when the cloud refuses', () => {
  beforeEach(() => resetAiForTests());

  it("the privacy lane's injection checks of 42 sample records reach the cloud once, and plain code still runs", async () => {
    const { checkInjection } = await import('@/privacy/injection/check');
    setLanguageModelForTests(undefined);
    const fake = useHybrid(() => {
      throw Object.assign(new Error('AI: genai config not found (AI/fetch-error)'), {
        name: 'FirebaseError', code: 'fetch-error', customErrorData: { status: 400 },
      });
    });
    const findings = [];
    for (let i = 0; i < 42; i += 1) findings.push((await checkInjection(`Sample email ${i}: the deposit is due on Friday.`, 'sample')).finding);
    expect(fake.callsFor('injection-check')).toHaveLength(1);
    expect(fake.calls[0].spec.mode).toBe('ONLY_IN_CLOUD');
    expect(findings.every((f) => f.suspicious === false && f.by === 'code')).toBe(true);
  });
});
