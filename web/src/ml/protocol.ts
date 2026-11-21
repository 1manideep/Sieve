// Messages between the page and the one on-device ML worker (20 section 6.1).

export type MlTask = 'embed' | 'pii' | 'rerank';
export type MlDevice = 'webgpu' | 'wasm';
export type MlPriority = 'foreground' | 'background';

export type ToMl =
  | { kind: 'init'; task: MlTask; device: MlDevice }
  | { kind: 'run'; id: number; task: MlTask; priority: MlPriority; input: unknown }
  | { kind: 'cancel'; id: number };

export type MlInitErrorCode = 'no-webgpu' | 'load-failed' | 'probe-failed' | 'no-task';

export type FromMl =
  | { kind: 'progress'; task: MlTask; loaded: number; total: number }
  | { kind: 'ready'; task: MlTask; device: MlDevice; loadMs: number }
  | { kind: 'init-error'; task: MlTask; code: MlInitErrorCode; message: string }
  | { kind: 'result'; id: number; task: MlTask; output: unknown; ms: number }
  | { kind: 'run-error'; id: number; task: MlTask; message: string };

export interface MlTaskHandler<I, O> {
  /** Load and probe; throws an MlInitError (or any error, read as load-failed). */
  init(device: MlDevice, onProgress: (loaded: number, total: number) => void): Promise<void>;
  run(input: I): Promise<{ output: O; transfer?: Transferable[] }>;
}

export class MlInitError extends Error {
  constructor(readonly code: MlInitErrorCode, message: string) {
    super(message);
    this.name = 'MlInitError';
  }
}

/** The embedding task's input and output (20 section 6.4). */
export interface EmbedInput { texts: string[] }                                   // at most EMBED_BATCH
export interface EmbedOutput { dims: number; count: number; data: Float32Array }  // count x dims, row-major, L2-normalized

/** The cross-encoder behind the reranker (rerank.task.ts), served from /models/ like the embedder. */
export const RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';
/**
 * One passage's cost before a device has been measured, at rerank.task.ts's token caps: an M2 in Chrome,
 * Nov 21, 2026 (WebGPU fp16 at 320 tokens, one WASM thread q8 at 192).
 */
export const RERANK_DEFAULT_MS_PER_PASSAGE: Record<MlDevice, number> = { webgpu: 12, wasm: 115 };

/** The reranker task's input: one question, the passages in the order the search gave them. */
export interface RerankInput {
  query: string;
  passages: string[];
  /** Wall-clock time (Date.now()) by which the task stops starting new batches, so a late or slow run ends early. */
  deadline?: number;
}

/** Scores for the first scores.length passages (higher is more relevant); fewer than given when the deadline came. */
export interface RerankOutput {
  scores: number[];
  /** Time spent scoring inside the worker, without the wait behind other jobs. */
  computeMs: number;
  /** The task's estimate of one passage's cost on this device, after this run. */
  msPerPassage: number;
}
