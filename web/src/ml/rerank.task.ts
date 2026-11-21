// The reranker task (docs/research/local-vector-search.md section 5.1): a cross-encoder reads the question with each
// passage and gives it a relevance score. ms-marco-MiniLM-L-6-v2 runs as fp16 on WebGPU and as q8 on WASM. The
// worker loads this module on the first rerank only (ml.worker.ts), so the embedder's start does not pay for it.
//
// Measured in Chrome 158 on an M2 MacBook (Nov 21, 2026), 160-word passages:
//   WebGPU fp16: 20 passages in 200 ms, 10 in 110 ms; 46 MB download.
//   WASM q8, one thread: 20 passages in 3.2 s at 265 tokens, in 2.2 s at 192 tokens; 23 MB download.
//   mxbai-rerank-xsmall-v1 ranked a little better but publishes only q8 (6 s for 20 on WebGPU, 7.5 s on WASM) and
//   fp32 (293 MB), so it does not fit the budget on either device.
import { AutoModelForSequenceClassification, AutoTokenizer, Tensor } from '@huggingface/transformers';
import { MlInitError, RERANK_DEFAULT_MS_PER_PASSAGE, RERANK_MODEL, type MlDevice, type MlTaskHandler, type RerankInput, type RerankOutput } from './protocol';

/** Per device: the ONNX file, the most tokens of one (question, passage) pair, passages per model call. */
export const RERANK_SETTINGS: Record<MlDevice, { dtype: 'fp16' | 'q8'; maxTokens: number; batch: number }> = {
  // 320 tokens hold a whole 160-word chunk with its title and the question; 10 per call measured faster than 20.
  webgpu: { dtype: 'fp16', maxTokens: 320, batch: 10 },
  // 192 tokens cost at most 2.5 points of top-1 on the seed questions against 256 and save 30% of the time; batches
  // of 4 cost 5% more than one batch and let the deadline stop a run within about half a second.
  wasm: { dtype: 'q8', maxTokens: 192, batch: 4 },
};

/** A loaded model must put the deposit answer above the flight; a device that computes garbage fails here. */
export const RERANK_PROBE = {
  query: 'How much was my security deposit?',
  passages: ['We received your security deposit of $1,200 on March 3.', 'Your flight departs Chicago at 7:45 AM on Friday.'],
} as const;

export function checkRerankProbe(scores: readonly number[]): void {
  const [good, bad] = scores;
  if (scores.length !== 2 || !Number.isFinite(good) || !Number.isFinite(bad)) throw new MlInitError('probe-failed', 'the reranker returned no scores');
  if (!((good as number) > (bad as number) + 1)) throw new MlInitError('probe-failed', 'the reranker failed its probe');
}

export interface PairEncoding { input_ids: number[]; attention_mask: number[]; token_type_ids?: number[] }

/**
 * Cuts one encoded pair to maxTokens. The question comes first and the passage's end is cut, and the closing special
 * token stays: transformers.js 3.7.5's own truncation drops it.
 */
export function fitPair(enc: PairEncoding, maxTokens: number): PairEncoding {
  if (enc.input_ids.length <= maxTokens) return enc;
  const cut = (a: number[]) => [...a.slice(0, maxTokens - 1), a[a.length - 1] as number];
  const out: PairEncoding = { input_ids: cut(enc.input_ids), attention_mask: cut(enc.attention_mask) };
  if (enc.token_type_ids) out.token_type_ids = cut(enc.token_type_ids);
  return out;
}

/** Pads a batch to its longest pair, row-major int64 data as the ONNX graph takes it. */
export function packBatch(encs: readonly PairEncoding[], padId: number): { dims: [number, number]; feeds: Record<string, BigInt64Array> } {
  const rows = encs.length;
  const width = Math.max(1, ...encs.map((e) => e.input_ids.length));
  const keys = (['input_ids', 'attention_mask', 'token_type_ids'] as const).filter((k) => encs.every((e) => e[k]));
  const feeds: Record<string, BigInt64Array> = {};
  for (const key of keys) {
    const data = new BigInt64Array(rows * width);
    if (key === 'input_ids' && padId !== 0) data.fill(BigInt(padId));
    encs.forEach((e, i) => (e[key] as number[]).forEach((x, j) => (data[i * width + j] = BigInt(x))));
    feeds[key] = data;
  }
  return { dims: [rows, width], feeds };
}

/**
 * Scores passages in batches until done or until the next batch would end after the deadline. The estimate per
 * passage follows each batch (the first measurement replaces the default), so a slow device stops sooner next time.
 */
export async function scoreWithin(
  passages: readonly string[],
  opts: { batch: number; deadline?: number; msPerPassage: number; measured: boolean; now: () => number },
  scoreBatch: (texts: string[]) => Promise<number[]>,
): Promise<{ scores: number[]; computeMs: number; msPerPassage: number; measured: boolean }> {
  const scores: number[] = [];
  let computeMs = 0;
  let per = opts.msPerPassage;
  let measured = opts.measured;
  for (let i = 0; i < passages.length; i += opts.batch) {
    const part = passages.slice(i, i + opts.batch);
    const t0 = opts.now();
    if (opts.deadline !== undefined && t0 + per * part.length > opts.deadline) break;
    const got = await scoreBatch(part);
    const spent = opts.now() - t0;
    computeMs += spent;
    scores.push(...got.slice(0, part.length));
    const m = spent / part.length;
    per = measured ? per * 0.5 + m * 0.5 : m;
    measured = true;
  }
  return { scores, computeMs: Math.round(computeMs), msPerPassage: Math.round(per * 10) / 10, measured };
}

/** IEEE half-precision bits to numbers, for a browser without Float16Array (its fp16 logits arrive as raw bits). */
export function halfBitsToNumbers(bits: Uint16Array): number[] {
  return Array.from(bits, (h) => {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
    if (exp === 0x1f) return frac ? NaN : sign * Infinity;
    return sign * 2 ** (exp - 15) * (1 + frac / 1024);
  });
}

interface ProgressInfo { file?: string; loaded?: number; total?: number }
interface Tokenizer {
  (text: string[], opts: { text_pair: string[]; add_special_tokens: boolean; return_tensor: false }): Record<string, number[][]>;
  pad_token_id?: number;
}
type Classifier = ((feeds: Record<string, Tensor>) => Promise<{ logits: Tensor }>) & { dispose(): Promise<unknown> };

export function createRerankTask(): MlTaskHandler<RerankInput, RerankOutput> {
  let tokenizer: Tokenizer | null = null;
  let model: Classifier | null = null;
  let settings = RERANK_SETTINGS.wasm;
  let msPerPassage = RERANK_DEFAULT_MS_PER_PASSAGE.wasm;
  let measured = false;

  const scoreBatch = async (query: string, texts: string[]): Promise<number[]> => {
    if (!tokenizer || !model) throw new Error('reranker not loaded');
    // a few characters per token at most: a huge passage is cut before the tokenizer reads all of it
    const cutTexts = texts.map((t) => t.slice(0, settings.maxTokens * 8));
    const enc = tokenizer(cutTexts.map(() => query), { text_pair: cutTexts, add_special_tokens: true, return_tensor: false });
    const ids = enc.input_ids ?? [];
    const pairs = ids.map((input_ids, i) => fitPair({
      input_ids,
      attention_mask: enc.attention_mask?.[i] ?? input_ids.map(() => 1),
      ...(enc.token_type_ids ? { token_type_ids: enc.token_type_ids[i] as number[] } : {}),
    }, settings.maxTokens));
    const { dims, feeds } = packBatch(pairs, tokenizer.pad_token_id ?? 0);
    const tensors: Record<string, Tensor> = {};
    for (const [k, v] of Object.entries(feeds)) tensors[k] = new Tensor('int64', v, dims);
    const { logits } = await model(tensors);
    const raw = logits.data as unknown;
    const values = logits.type === 'float16' && raw instanceof Uint16Array ? halfBitsToNumbers(raw) : Array.from((logits.type === 'float32' ? logits : logits.to('float32')).data as Float32Array);
    return values.slice(0, texts.length);
  };

  return {
    async init(device: MlDevice, onProgress) {
      settings = RERANK_SETTINGS[device];
      msPerPassage = RERANK_DEFAULT_MS_PER_PASSAGE[device];
      measured = false;
      const files = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (info: unknown) => {
        const p = info as ProgressInfo;
        if (!p.file || typeof p.loaded !== 'number' || typeof p.total !== 'number') return;
        files.set(p.file, { loaded: p.loaded, total: p.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        onProgress(loaded, total);
      };
      try {
        await model?.dispose();
        tokenizer = (await AutoTokenizer.from_pretrained(RERANK_MODEL, { progress_callback })) as unknown as Tokenizer;
        model = (await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: settings.dtype, device, progress_callback })) as unknown as Classifier;
      } catch (e) {
        model = null;
        throw new MlInitError('load-failed', String((e as Error)?.message ?? e).slice(0, 200));
      }
      checkRerankProbe(await scoreBatch(RERANK_PROBE.query, [...RERANK_PROBE.passages]));
      // One full batch at the token cap while loading, so the first question does not pay for compiling kernels and
      // growing memory: the first WebGPU run of 20 took 400 ms against 210 after it (Nov 21, 2026).
      const long = Array.from({ length: 40 }, () => RERANK_PROBE.passages[0]).join(' ');
      await scoreBatch(RERANK_PROBE.query, Array.from({ length: settings.batch }, () => long));
    },
    async run(input: RerankInput) {
      const query = String(input.query ?? '');
      const passages = Array.isArray(input.passages) ? input.passages.map((p) => String(p ?? '')) : [];
      const out = await scoreWithin(passages, { batch: settings.batch, deadline: input.deadline, msPerPassage, measured, now: () => Date.now() }, (texts) => scoreBatch(query, texts));
      msPerPassage = out.msPerPassage;
      measured = out.measured;
      return { output: { scores: out.scores, computeMs: out.computeMs, msPerPassage: out.msPerPassage } };
    },
  };
}

export const rerankTask = createRerankTask();
