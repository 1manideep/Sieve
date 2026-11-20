// The Rampart PII model as a task of 20's shared ML worker (01 section 11.1, 20 section 6.2; body of 11 section 5.4.4
// steps 2 to 5). The worker's env.ts configures transformers.js (local files under /models/, no remote fallback,
// self-hosted ORT wasm) before this module loads. This file runs only inside that worker.
import { pipeline } from '@huggingface/transformers';
import { detectHeuristics, detectNer, premask, projectMaskedSpan, type TokenClassifier } from '@nationaldesignstudio/rampart';
import { MODEL_DIR, MODEL_MIN_SCORE, MODEL_PROBE_TEXT } from '../constants';
import type { ModelSpan } from './labels';
import { PiiTaskInitError, type PiiDevice, type PiiTaskHandler, type PiiTaskInput, type PiiTaskOutput } from './task-types';

type Pipe = (text: string, options?: unknown) => Promise<unknown[]>;
interface Tokenizer {
  encode?: (text: string, options?: { add_special_tokens?: boolean }) => number[];
  tokenize?: (text: string) => string[];
}
interface ProgressEvent { status?: string; file?: string; loaded?: number; total?: number }

let classifier: TokenClassifier | undefined;
let chain: Promise<unknown> = Promise.resolve();

/** Wraps the pipeline as Rampart's TokenClassifier; countTokens makes detectNer slide 500-token windows. */
export function wrapClassifier(pipe: unknown): TokenClassifier {
  const call = pipe as Pipe;
  const c = ((t: string, o?: unknown) => call(t, o)) as unknown as TokenClassifier;
  const tok = (pipe as { tokenizer?: Tokenizer }).tokenizer;
  if (tok?.encode) c.countTokens = (t: string) => tok.encode!(t, { add_special_tokens: false }).length;
  if (tok?.tokenize) c.tokenize = (t: string) => tok.tokenize!(t);
  return c;
}

/** Model spans for text: Rampart's heuristics only premask (as in training); heuristic spans are not returned. */
export async function detectWith(cls: TokenClassifier, text: string): Promise<ModelSpan[]> {
  const heuristics = detectHeuristics(text);
  const map = premask(text, heuristics);
  const masked = await detectNer(map.masked, cls, MODEL_MIN_SCORE);
  const out: ModelSpan[] = [];
  for (const s of masked) {
    const p = projectMaskedSpan(s, text, map);
    if (p) out.push({ start: p.start, end: p.end, label: p.label, score: p.score });
  }
  return out;
}

/** The probe catches devices that load the model but compute garbage: "Maria" (12 to 17) must be a name. */
export function probePasses(spans: readonly ModelSpan[]): boolean {
  return spans.some((s) => (s.label === 'GIVEN_NAME' || s.label === 'SURNAME') && s.start < 17 && s.end > 12);
}

export const piiTask: PiiTaskHandler = {
  async init(device: PiiDevice, onProgress) {
    const files = new Map<string, { loaded: number; total: number }>();
    let pipe: unknown;
    try {
      pipe = await pipeline('token-classification', MODEL_DIR, {
        dtype: 'q4',
        device,
        progress_callback: (e: ProgressEvent) => {
          if (!e.file || typeof e.loaded !== 'number' || typeof e.total !== 'number') return;
          files.set(e.file, { loaded: e.loaded, total: e.total });
          let loaded = 0;
          let total = 0;
          for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          onProgress(loaded, total);
        },
      } as Parameters<typeof pipeline>[2]);
    } catch (e) {
      throw new PiiTaskInitError('load-failed', e instanceof Error ? e.message : 'The privacy model could not load.');
    }
    const cls = wrapClassifier(pipe);
    if (!cls.countTokens) throw new PiiTaskInitError('load-failed', 'The privacy model tokenizer has no encode().');
    const probe = await detectWith(cls, MODEL_PROBE_TEXT);
    if (!probePasses(probe)) throw new PiiTaskInitError('probe-failed', 'The privacy model gave wrong results on this device.');
    classifier = cls;
  },
  run(input: PiiTaskInput) {
    // one ONNX session must not run two inferences at once
    const job = chain.then(async (): Promise<{ output: PiiTaskOutput }> => {
      if (!classifier) throw new Error('The privacy model is not loaded.');
      return { output: { spans: await detectWith(classifier, input.text) } };
    });
    chain = job.catch(() => undefined);
    return job;
  },
};
