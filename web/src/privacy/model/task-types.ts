// The task-handler shape of 20's shared ML worker (20 section 6.1, MlTaskHandler), declared here structurally so this
// module does not depend on web/src/ml at compile time.
import type { ModelSpan } from './labels';

export type PiiDevice = 'webgpu' | 'wasm';
export interface PiiTaskInput { text: string }
export interface PiiTaskOutput { spans: ModelSpan[] }

export interface PiiTaskHandler {
  init(device: PiiDevice, onProgress: (loaded: number, total: number) => void): Promise<void>;
  run(input: PiiTaskInput): Promise<{ output: PiiTaskOutput; transfer?: Transferable[] }>;
}

export class PiiTaskInitError extends Error {
  constructor(readonly code: 'no-webgpu' | 'load-failed' | 'probe-failed', message: string) {
    super(message);
    this.name = 'PiiTaskInitError';
  }
}
