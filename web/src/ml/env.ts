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
  wasm.numThreads = 1;                      // not cross-origin isolated: no SharedArrayBuffer threads
}

export const ML_ENV_READY = true;
