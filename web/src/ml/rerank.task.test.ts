// The reranker task's pure parts (rerank.task.ts): pair cutting, batch packing, the deadline loop, fp16 decoding and
// the load probe. The model itself runs in Chrome only.
import { describe, expect, it } from 'vitest';
import { MlInitError } from './protocol';
import { RERANK_SETTINGS, checkRerankProbe, fitPair, halfBitsToNumbers, packBatch, scoreWithin } from './rerank.task';

describe('fitPair', () => {
  it('leaves a pair that fits alone', () => {
    const enc = { input_ids: [101, 7, 102, 8, 102], attention_mask: [1, 1, 1, 1, 1] };
    expect(fitPair(enc, 5)).toBe(enc);
  });
  it('cuts the passage end and keeps the closing token in every array', () => {
    const enc = { input_ids: [101, 7, 102, 8, 9, 10, 102], attention_mask: [1, 1, 1, 1, 1, 1, 1], token_type_ids: [0, 0, 0, 1, 1, 1, 1] };
    expect(fitPair(enc, 5)).toEqual({ input_ids: [101, 7, 102, 8, 102], attention_mask: [1, 1, 1, 1, 1], token_type_ids: [0, 0, 0, 1, 1] });
  });
});

describe('packBatch', () => {
  it('pads to the longest pair with the pad id and zero masks, row-major', () => {
    const { dims, feeds } = packBatch([
      { input_ids: [1, 2, 3], attention_mask: [1, 1, 1], token_type_ids: [0, 0, 1] },
      { input_ids: [4], attention_mask: [1], token_type_ids: [0] },
    ], 9);
    expect(dims).toEqual([2, 3]);
    expect([...(feeds.input_ids ?? [])]).toEqual([1n, 2n, 3n, 4n, 9n, 9n]);
    expect([...(feeds.attention_mask ?? [])]).toEqual([1n, 1n, 1n, 1n, 0n, 0n]);
    expect([...(feeds.token_type_ids ?? [])]).toEqual([0n, 0n, 1n, 0n, 0n, 0n]);
  });
  it('leaves out token types a tokenizer does not give', () => {
    expect(Object.keys(packBatch([{ input_ids: [1], attention_mask: [1] }], 0).feeds).sort()).toEqual(['attention_mask', 'input_ids']);
  });
});

describe('scoreWithin', () => {
  const texts = Array.from({ length: 10 }, (_, i) => `t${i}`);
  /** A scorer on a fake clock: each passage costs `cost` ms. */
  const fake = (cost: number) => {
    let t = 1_000;
    const batches: string[][] = [];
    return {
      now: () => t,
      batches,
      score: async (part: string[]) => {
        batches.push(part);
        t += cost * part.length;
        return part.map((p) => Number(p.slice(1)));
      },
    };
  };

  it('scores everything in batches when there is no deadline', async () => {
    const f = fake(10);
    const out = await scoreWithin(texts, { batch: 4, msPerPassage: 115, measured: false, now: f.now }, f.score);
    expect(out.scores).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(f.batches.map((b) => b.length)).toEqual([4, 4, 2]);
    expect(out.computeMs).toBe(100);
    expect(out.msPerPassage).toBe(10);   // the first measurement replaced the default
    expect(out.measured).toBe(true);
  });

  it('stops before a batch that would end after the deadline', async () => {
    const f = fake(100);
    const out = await scoreWithin(texts, { batch: 4, deadline: 1_000 + 900, msPerPassage: 100, measured: true, now: f.now }, f.score);
    expect(out.scores).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);   // 800 ms done; a third batch of 2 would end at 2,000
  });

  it('does not start when the first batch cannot make the deadline', async () => {
    const f = fake(100);
    const out = await scoreWithin(texts, { batch: 4, deadline: 1_000 + 300, msPerPassage: 100, measured: true, now: f.now }, f.score);
    expect(out.scores).toEqual([]);
    expect(f.batches).toHaveLength(0);
    expect(out.measured).toBe(true);
  });

  it('learns a slow device within the run and stops sooner', async () => {
    const f = fake(300);
    const out = await scoreWithin(texts, { batch: 4, deadline: 1_000 + 2_000, msPerPassage: 115, measured: false, now: f.now }, f.score);
    expect(out.scores).toHaveLength(4);   // 1.2 s for the first batch; the next one would end at 2.4 s
    expect(out.msPerPassage).toBe(300);
  });
});

describe('the reranker settings and probe', () => {
  it('reads fp16 on WebGPU and q8 on WASM, with a shorter cut on WASM', () => {
    expect(RERANK_SETTINGS.webgpu.dtype).toBe('fp16');
    expect(RERANK_SETTINGS.wasm.dtype).toBe('q8');
    expect(RERANK_SETTINGS.wasm.maxTokens).toBeLessThan(RERANK_SETTINGS.webgpu.maxTokens);
  });
  it('decodes half-precision bits', () => {
    expect(halfBitsToNumbers(new Uint16Array([0x3c00, 0xc000, 0x4800, 0x0000, 0x3555, 0x7c00]))).toEqual([1, -2, 8, 0, expect.closeTo(0.3333, 3), Infinity]);
  });
  it('passes a model that puts the deposit above the flight, and fails garbage', () => {
    expect(() => checkRerankProbe([8.1, -10.9])).not.toThrow();
    expect(() => checkRerankProbe([1, 1.5])).toThrow(MlInitError);
    expect(() => checkRerankProbe([Number.NaN, 0])).toThrow(/no scores/);
    expect(() => checkRerankProbe([3])).toThrow(MlInitError);
  });
});
