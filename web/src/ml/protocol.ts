// Messages between the page and the one on-device ML worker (20 section 6.1).

export type MlTask = 'embed' | 'pii';
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
