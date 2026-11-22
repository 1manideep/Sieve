// The real MiniLM embedder in a plain Node process, for retrieval tests (20 A-SR-1). onnxruntime-node rejects
// typed arrays from the jsdom test realm, so the model runs here and vectors travel as base64 JSON lines.
// Same settings as web/src/ml/embed.task.ts: Xenova/all-MiniLM-L6-v2, q8, mean pooling, normalized.
// Models load only from MODEL_DIR (the spike cache); nothing is downloaded.
import { createInterface } from 'node:readline';
import { pipeline, env } from '@huggingface/transformers';

// The search eval may try another embedding model (bench/search-eval, --embed-model): it downloads into the eval's
// own temp folder, never into the repository. Everything else uses the app's model from MODEL_DIR.
const MODEL = process.env.EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';
const POOLING = process.env.EMBED_POOLING || 'mean';
if (process.env.EMBED_REMOTE_CACHE) {
  env.allowRemoteModels = true;
  env.cacheDir = process.env.EMBED_REMOTE_CACHE;
} else {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = process.env.MODEL_DIR;
}

const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
process.stdout.write(JSON.stringify({ ready: true }) + '\n');

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const { id, texts } = JSON.parse(line);
  try {
    const out = await extractor(texts, { pooling: POOLING, normalize: true });
    const data = Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength).toString('base64');
    process.stdout.write(JSON.stringify({ id, dims: out.dims[1], count: out.dims[0], data }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, error: String(e) }) + '\n');
  }
});
