// A cross-encoder reranker in a plain Node process, for the offline search eval only (bench/search-eval/README.md).
// By default the app's own model (web/src/ml/protocol.ts RERANK_MODEL, Xenova/ms-marco-MiniLM-L-6-v2) at its WASM
// settings (q8, 192 tokens a pair), through @huggingface/transformers (the app's version), on the native runtime.
// Requests and replies are JSON lines on stdin and stdout. The model is downloaded once into RERANK_CACHE (a temp
// folder that run.mjs passes in), never into the repository.
import { createInterface } from 'node:readline';
import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers';

const MODEL = process.env.RERANK_MODEL || 'Xenova/ms-marco-MiniLM-L-6-v2';
const MAX_TOKENS = Number(process.env.RERANK_MAX_TOKENS || 192);

env.cacheDir = process.env.RERANK_CACHE;
env.allowLocalModels = false;
env.allowRemoteModels = true;

const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await AutoModelForSequenceClassification.from_pretrained(MODEL, { dtype: 'q8' });
process.stdout.write(JSON.stringify({ ready: true }) + '\n');

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const { id, query, passages } = JSON.parse(line);
  try {
    const t0 = performance.now();
    const inputs = tokenizer(new Array(passages.length).fill(query), { text_pair: passages, padding: true, truncation: true, max_length: MAX_TOKENS });
    const { logits } = await model(inputs);
    const scores = Array.from(logits.data).filter((_, i) => i % logits.dims[1] === 0);
    process.stdout.write(JSON.stringify({ id, scores, ms: Math.round(performance.now() - t0) }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, error: String(e) }) + '\n');
  }
});
