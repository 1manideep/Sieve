// The embedding task (20 section 6.4): MiniLM q8, mean pooling, L2-normalized, probed at load.
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '@sieve/shared';
import { MlInitError, type EmbedInput, type EmbedOutput, type MlDevice, type MlTaskHandler } from './protocol';

export const EMBED_PROBE = ['security deposit for the apartment', 'the deposit I paid my landlord', 'flight to Seattle in December'] as const;

function cos(data: Float32Array, i: number, j: number, dims: number): number {
  let s = 0;
  for (let k = 0; k < dims; k++) s += (data[i * dims + k] ?? 0) * (data[j * dims + k] ?? 0);
  return s;
}

/** Rejects a device that loads the model but computes garbage (20 section 6.4). */
export function checkProbe(out: EmbedOutput): void {
  if (out.dims !== EMBEDDING_DIMS || out.count !== EMBED_PROBE.length) throw new MlInitError('probe-failed', `embedding has ${out.dims} dims`);
  for (let i = 0; i < out.count; i++) {
    const norm = Math.sqrt(cos(out.data, i, i, out.dims));
    if (Math.abs(norm - 1) > 0.01) throw new MlInitError('probe-failed', 'embedding is not normalized');
  }
  if (!(cos(out.data, 0, 1, out.dims) > cos(out.data, 0, 2, out.dims) + 0.1)) throw new MlInitError('probe-failed', 'embedding failed the similarity probe');
}

interface ProgressInfo { status?: string; file?: string; loaded?: number; total?: number }
/** transformers.js's pipeline() overloads are too wide for the checker here; this is the one call Sieve makes. */
type MakeExtractor = (task: 'feature-extraction', model: string, opts: { dtype: 'q8'; device: MlDevice; progress_callback: (p: ProgressInfo) => void }) => Promise<FeatureExtractionPipeline>;

export function createEmbedTask(): MlTaskHandler<EmbedInput, EmbedOutput> {
  let extractor: FeatureExtractionPipeline | null = null;

  const embed = async (texts: string[]): Promise<EmbedOutput> => {
    if (!extractor) throw new Error('embedder not loaded');
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    const raw = out.data as Float32Array;
    const data = raw.buffer.byteLength === raw.byteLength && raw.byteOffset === 0 ? raw : new Float32Array(raw);
    return { dims: Number(out.dims[1] ?? EMBEDDING_DIMS), count: Number(out.dims[0] ?? texts.length), data };
  };

  return {
    async init(device: MlDevice, onProgress) {
      const files = new Map<string, { loaded: number; total: number }>();
      try {
        extractor = await (pipeline as unknown as MakeExtractor)('feature-extraction', EMBEDDING_MODEL, {
          dtype: 'q8',
          device,
          progress_callback: (p: ProgressInfo) => {
            if (!p.file || typeof p.loaded !== 'number' || typeof p.total !== 'number') return;
            files.set(p.file, { loaded: p.loaded, total: p.total });
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
              loaded += f.loaded;
              total += f.total;
            }
            onProgress(loaded, total);
          },
        });
      } catch (e) {
        throw new MlInitError('load-failed', String((e as Error)?.message ?? e).slice(0, 200));
      }
      checkProbe(await embed([...EMBED_PROBE]));
    },
    async run(input: EmbedInput) {
      const output = await embed(input.texts);
      return { output, transfer: [output.data.buffer] };
    },
  };
}

export const embedTask = createEmbedTask();
