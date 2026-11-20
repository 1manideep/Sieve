// The browser model: the 'pii' task for 20's ML worker with transformers.js mocked (no model files in tests), the
// label map, and the main-thread client's states. The real model runs only in the manual browser check.
import type { PiiSpan } from '@sieve/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MODEL_PROBE_TEXT } from '../constants';
import { clearPrivacyCaches, getPrivacyModelStatus, onPrivacyModelStatus, warmupPrivacyModel } from '../index';
import { detectWithModel, ModelNotReadyError, ModelUnavailableError, setPrivacyModelHost } from '../model/client';
import { cleanModelSpans } from '../model/clean';
import { piiTypeForLabel } from '../model/labels';
import { piiTask, probePasses } from '../model/pii.task';
import { PiiTaskInitError } from '../model/task-types';
import { fakeModelHost } from './helpers';

const tf = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock('@huggingface/transformers', () => tf);

/** A fake token-classification pipeline: finds the given names in whatever text it is asked about. */
function fakePipeline(names: string[], opts: { encode?: boolean } = {}) {
  const pipe = async (text: string) => {
    const out: { entity_group: string; start: number; end: number; score: number; word: string }[] = [];
    for (const n of names) {
      const at = text.toLowerCase().indexOf(n.toLowerCase());
      if (at >= 0) out.push({ entity_group: 'GIVEN_NAME', start: at, end: at + n.length, score: 0.95, word: n.toLowerCase() });
    }
    return out;
  };
  const tokenizer = opts.encode === false ? {} : { encode: (t: string) => t.split(/\s+/).filter(Boolean).map((_, i) => i) };
  return Object.assign(pipe, { tokenizer });
}

describe('pii.task (20 section 6.1 MlTaskHandler)', () => {
  beforeEach(() => {
    tf.pipeline.mockReset();
  });

  test('init loads the local model, sums progress, passes the probe; run returns model spans only', async () => {
    tf.pipeline.mockImplementation(async (_task: string, _model: string, o: { progress_callback: (e: object) => void }) => {
      o.progress_callback({ status: 'progress', file: 'onnx/model_q4.onnx', loaded: 50, total: 100 });
      o.progress_callback({ status: 'progress', file: 'tokenizer.json', loaded: 10, total: 10 });
      return fakePipeline(['Maria', 'Priya']);
    });
    const progress: [number, number][] = [];
    await piiTask.init('wasm', (l, t) => progress.push([l, t]));
    expect(tf.pipeline).toHaveBeenCalledWith('token-classification', 'rampart-b1993e4', expect.objectContaining({ dtype: 'q4', device: 'wasm' }));
    expect(progress.at(-1)).toEqual([60, 110]);
    const { output } = await piiTask.run({ text: 'Lunch with Priya and card 4111 1111 1111 1111.' });
    expect(output.spans).toEqual([expect.objectContaining({ start: 11, end: 16, label: 'GIVEN_NAME' })]);   // heuristic card spans only premask
  });

  test('a model that computes garbage fails the probe', async () => {
    tf.pipeline.mockResolvedValue(fakePipeline([]));
    await expect(piiTask.init('webgpu', () => undefined)).rejects.toMatchObject({ code: 'probe-failed' });
  });

  test('a failed load and a tokenizer without encode() are load failures', async () => {
    tf.pipeline.mockRejectedValue(new Error('404 model'));
    await expect(piiTask.init('wasm', () => undefined)).rejects.toBeInstanceOf(PiiTaskInitError);
    tf.pipeline.mockResolvedValue(fakePipeline(['Maria'], { encode: false }));
    await expect(piiTask.init('wasm', () => undefined)).rejects.toMatchObject({ code: 'load-failed' });
  });

  test('the probe needs a name over Maria', () => {
    expect(MODEL_PROBE_TEXT.slice(12, 17)).toBe('Maria');
    expect(probePasses([{ start: 12, end: 25, label: 'GIVEN_NAME', score: 0.9 }])).toBe(true);
    expect(probePasses([{ start: 0, end: 6, label: 'GIVEN_NAME', score: 0.9 }])).toBe(false);
  });
});

describe('label map (11 section 5.4.2)', () => {
  test('names, contact details, ids, address parts; coarse places and links dropped', () => {
    expect(piiTypeForLabel('GIVEN_NAME', 'Dana')).toBe('name');
    expect(piiTypeForLabel('B-SURNAME', 'Lee')).toBe('name');
    expect(piiTypeForLabel('PASSPORT', 'X1234567')).toBe('other');
    expect(piiTypeForLabel('STREET_NAME', 'Oak Street')).toBe('address');
    expect(piiTypeForLabel('BANK_ACCOUNT', 'GB82 WEST 1234 5698 7654 32')).toBe('iban');
    expect(piiTypeForLabel('BANK_ACCOUNT', '000123456789')).toBe('account');
    for (const l of ['CITY', 'STATE', 'ZIP_CODE', 'URL', 'SSN', 'NOT_A_LABEL']) expect(piiTypeForLabel(l, 'x')).toBeNull();
  });
});

describe('model client (11 section 5.4.5)', () => {
  test('warmup reaches ready and notifies listeners', async () => {
    setPrivacyModelHost(fakeModelHost(() => [], { device: 'webgpu' }));
    const seen: string[] = [];
    const off = onPrivacyModelStatus((s) => seen.push(s.state));
    const status = await warmupPrivacyModel();
    off();
    expect(status).toMatchObject({ state: 'ready', device: 'webgpu' });
    expect(seen).toContain('loading');
    expect(getPrivacyModelStatus().state).toBe('ready');
    expect(warmupPrivacyModel()).toBe(warmupPrivacyModel());              // idempotent: the same promise
  });

  test('a failed load stays failed, and detection refuses at once', async () => {
    setPrivacyModelHost(fakeModelHost(() => [], { fail: true }));
    expect((await warmupPrivacyModel()).state).toBe('failed');
    await expect(detectWithModel('x', { priority: 'background', wait: true })).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  test('no host in this build: failed with a reason', async () => {
    setPrivacyModelHost(null);
    const s = await warmupPrivacyModel();
    expect(s.state).toBe('failed');
    expect(s.error).toBeTruthy();
  });

  test('share time never waits: a model that is not ready throws at once', async () => {
    setPrivacyModelHost(fakeModelHost(() => []));
    await expect(detectWithModel('x', { priority: 'foreground', wait: false })).rejects.toBeInstanceOf(ModelNotReadyError);
  });

  test('background detection waits for loading, then runs', async () => {
    const host = fakeModelHost(() => [{ start: 0, end: 4, label: 'GIVEN_NAME', score: 0.9 }]);
    setPrivacyModelHost(host);
    const res = await detectWithModel('Dana here', { priority: 'background', wait: true });
    expect(res.spans).toHaveLength(1);
    expect(host.calls).toEqual(['Dana here']);
  });

  test('clearPrivacyCaches drops a detection still in flight', async () => {
    let release: () => void = () => undefined;
    const host = fakeModelHost(() => []);
    host.run = () => new Promise((r) => {
      release = () => r({ spans: [] });
    });
    setPrivacyModelHost(host);
    await warmupPrivacyModel();
    const pending = detectWithModel('x', { priority: 'background', wait: true });
    await Promise.resolve();
    clearPrivacyCaches();
    release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('model span hygiene (artifacts seen with the real weights on the persona corpus)', () => {
  const span = (text: string, match: string, type: PiiSpan['type']): PiiSpan => {
    const start = text.indexOf(match);
    return { start, end: start + match.length, type, by: 'model', score: 0.9 };
  };
  const values = (text: string, spans: PiiSpan[]) => spans.map((s) => text.slice(s.start, s.end));

  test('greetings, line breaks, cut words and org names', () => {
    const t = 'Hi Alex,\n\nBest,\nDana Whitfield\nThistlewick Property Management';
    const out = cleanModelSpans(t, [span(t, 'Hi Alex', 'name'), span(t, 'Whitfield\nThistlewick Prop', 'name')]);
    expect(values(t, out)).toEqual(['Alex', 'Whitfield']);
  });
  test('address parts need a street name; ids after order, booking and meeting labels are not personal', () => {
    const t = 'Flight SA 1432, seat 14C, booking reference K7Q2LM, order 2133734253. Keys at 1847 W Tamsin Ave.';
    const out = cleanModelSpans(t, [
      span(t, 'SA', 'address'), span(t, '1432', 'address'), span(t, '14C', 'address'), span(t, 'K7Q2LM', 'other'),
      span(t, '2133734253', 'other'), span(t, '1847', 'address'), span(t, 'W Tamsin Ave', 'address'),
    ]);
    expect(values(t, out)).toEqual(['1847', 'W Tamsin Ave']);
  });
  test('leading punctuation is trimmed', () => {
    const t = 'from 3A. Rafael Duarte and I';
    expect(values(t, cleanModelSpans(t, [span(t, '. Rafael Duarte', 'name')]))).toEqual(['Rafael Duarte']);
  });
});
