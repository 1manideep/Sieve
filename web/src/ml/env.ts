// transformers.js settings shared by every task in the ML worker (20 section 6.2; identical to 11's settings).
// Models and the ONNX runtime come only from Sieve's own origin; nothing is fetched from huggingface.co.
import { env } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;              // never fetch from huggingface.co at run time
env.localModelPath = '/models/';
env.useBrowserCache = true;                 // Cache API 'transformers-cache'
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.wasmPaths = new URL('/ort/', self.location.origin).href;
  // Threads need SharedArrayBuffer, which only a cross-origin isolated page has; Hosting sends no COOP or COEP today,
  // so this is one thread. Isolated, 4 threads ran the reranker 3 to 3.5x faster on an M2 (Nov 21, 2026); half the cores
  // at most, so indexing never takes the whole machine.
  const cores = (globalThis.navigator as { hardwareConcurrency?: number } | undefined)?.hardwareConcurrency ?? 2;
  wasm.numThreads = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.max(1, Math.min(4, Math.floor(cores / 2))) : 1;
}

export const ML_ENV_READY = true;
