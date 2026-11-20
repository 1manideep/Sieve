import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the adapter tests run the real SDK routing (10 section 15)
import { AIError, getAI, GoogleAIBackend, type GenerateContentRequest } from 'firebase/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNanoAvailability } from '../device/availability';
import { setLanguageModelForTests } from '../device/languageModel';
import { clearModelCache, getHybrid, modelFor, type ModelSpec } from '../hybrid';
import { setAiInstanceForTests } from '../init';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';

const SYSTEM = 'You answer in one word.';
const spec = (over: Partial<ModelSpec> = {}): ModelSpec => ({
  purpose: 'select-answer', mode: 'ONLY_ON_DEVICE', system: SYSTEM, image: false, cloudModel: 'gemini-3.5-flash-lite', ...over,
});
const request = (text: string): GenerateContentRequest => ({ contents: [{ role: 'user', parts: [{ type: 'text', text }] }] });

let app: FirebaseApp;
let fetchMock: ReturnType<typeof vi.fn>;

function cloudResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('SieveDeviceAdapter with the real SDK (10 section 16.5)', () => {
  beforeEach(() => {
    resetAiForTests();
    app = initializeApp({ apiKey: 'test', projectId: 'test', appId: '1:1:web:1' }, `adapter-${Math.random()}`);
    setAiInstanceForTests(getAI(app, { backend: new GoogleAIBackend() }));
    fetchMock = vi.fn(async () => cloudResponse('cloud says hi'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    clearModelCache();
    await deleteApp(app);
  });

  it('AD-1: ONLY_ON_DEVICE runs on the fake Nano with one clone and one destroy, and no fetch', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'available' }, respond: () => 'BANANA' });
    setLanguageModelForTests(lm);
    await getNanoAvailability();
    const res = await modelFor(spec()).generateContent(request('Say a fruit'));
    expect(res.response.text()).toBe('BANANA');
    expect(res.response.inferenceSource).toBe('on_device');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lm.counters.clones).toBe(1);
    expect(lm.counters.destroys).toBe(1);
    expect(lm.createOptions[0].initialPrompts).toEqual([{ role: 'system', content: SYSTEM }]);
  });

  it('AD-2: ONLY_ON_DEVICE with Nano unavailable throws unsupported, with no fetch', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'unavailable', image: 'unavailable' } }));
    await getNanoAvailability();
    const err = await modelFor(spec()).generateContent(request('x')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIError);
    expect((err as AIError).code).toBe('unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AD-3: no Prompt API at all never reaches the SDK\'s "no adapter means cloud" path', async () => {
    setLanguageModelForTests(undefined);
    await getNanoAvailability();
    const err = await modelFor(spec()).generateContent(request('x')).catch((e: unknown) => e);
    expect((err as AIError).code).toBe('unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AD-4: PREFER_ON_DEVICE without Nano goes to the cloud with only the SDK\'s fields', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'unavailable', image: 'unavailable' } }));
    await getNanoAvailability();
    const res = await getHybrid().generate(spec({ mode: 'PREFER_ON_DEVICE' }), [{ text: 'hello' }], { signal: new AbortController().signal, timeoutMs: 5000 });
    expect(res).toEqual({ text: 'cloud says hi', source: 'in_cloud' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    for (const key of Object.keys(body)) expect(['contents', 'generationConfig', 'systemInstruction', 'safetySettings']).toContain(key);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
  });

  it('AD-5: streaming yields the device deltas through the SDK and destroys the session', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'available' }, chunks: () => ['Your ', 'deposit'] });
    setLanguageModelForTests(lm);
    await getNanoAvailability();
    const { stream, response } = await modelFor(spec()).generateContentStream(request('x'));
    const pieces: string[] = [];
    for await (const chunk of stream) pieces.push(chunk.text());
    const final = await response;
    expect(pieces).toEqual(['Your ', 'deposit']);
    expect(final.text()).toBe('Your deposit');
    expect(final.inferenceSource).toBe('on_device');
    await vi.waitFor(() => expect(lm.counters.destroys).toBe(1));
    const seen: string[] = [];
    const viaHybrid = await getHybrid().stream(spec(), [{ text: 'x' }], { signal: new AbortController().signal, timeoutMs: 5000, onText: (s) => seen.push(s) });
    expect(viaHybrid).toEqual({ text: 'Your deposit', source: 'on_device' });
    expect(seen).toEqual(['Your ', 'Your deposit']);
  });

  it('AD-6: a second call clones the warm base and sends only the new user message', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'available' }, respond: () => 'ok' });
    setLanguageModelForTests(lm);
    await getNanoAvailability();
    await modelFor(spec()).generateContent(request('first question'));
    const creates = lm.counters.creates;
    await modelFor(spec()).generateContent(request('second question'));
    expect(lm.counters.creates).toBe(creates);
    expect(lm.counters.clones).toBe(2);
    expect(lm.promptInputs[1]).toEqual([{ role: 'user', content: [{ type: 'text', value: 'second question' }] }]);
  });

  it('caches one GenerativeModel per spec; ONLY_IN_CLOUD gets no adapter', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
    expect(modelFor(spec())).toBe(modelFor(spec()));
    expect(modelFor(spec({ system: 'other' }))).not.toBe(modelFor(spec()));
    await getNanoAvailability();
    const res = await getHybrid().generate(spec({ mode: 'ONLY_IN_CLOUD' }), [{ text: 'x' }], { signal: new AbortController().signal, timeoutMs: 5000 });
    expect(res.source).toBe('in_cloud');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
