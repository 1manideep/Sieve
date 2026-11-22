#!/usr/bin/env node
// The offline search eval (bench/search-eval/README.md): `npm run eval:search -- [options]` from the repo root.
// Downloads, when asked, go to a temp folder outside the repository and stay there between runs; --clean removes it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CACHE = process.env.SIEVE_EVAL_CACHE || join(tmpdir(), 'sieve-search-eval');
const DISTRACTOR_URL = 'https://huggingface.co/datasets/SetFit/enron_spam/resolve/main/test.jsonl';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

if (flag('help')) {
  console.log(`Usage: npm run eval:search -- [options]
  --seed-only          only the 46 seed items (no download)
  --distractors-only   only the seed items plus the public distractor mail
  --rerank <modes>     none, model or none,model (default none). "model" downloads a cross-encoder once
  --rerank-model <id>  the cross-encoder (default the app's, Xenova/ms-marco-MiniLM-L-6-v2)
  --rerank-tokens <n>  the most tokens of a (question, passage) pair (default 192, the app's WASM setting)
  --rerank-limit <n>   score only the first n passages, the rest keep their place (the app on one WASM thread
                       scores about 12 within its budget; default 20, as on WebGPU)
  --rerank-pool <n>    how many of the best candidates the reranker gets (the app: 20)
  --embed-model <id>   another embedding model (384 numbers per text) instead of the app's, downloaded once into
                       the temp folder; with --embed-pooling mean|cls, --query-prefix and --passage-prefix as it needs
  --sweep <file.json>  a list of { label, tuning } to run against SEARCH_TUNING (web/src/index/config.ts)
  --label <name>       the name of this configuration in the table (default "current")
  --extra <file.json>  more emails and questions of your own, { items: [{ id, title, from, date, text }], questions },
                       added after the other sets; keep the file outside the repository
  --depth <n>          ask for and score n candidates, to see how far down a missed item sits (default 7)
  --out <file.json>    where the per-question results go (default: last-run.json in the temp folder)
  --clean              delete the temp folder (${CACHE}) and stop`);
  process.exit(0);
}

if (flag('clean')) {
  rmSync(CACHE, { recursive: true, force: true });
  console.log(`Removed ${CACHE}`);
  process.exit(0);
}

if (!existsSync(join(ROOT, 'spikes', 'search', '.model-cache', 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx'))) {
  console.error('The MiniLM model cache (spikes/search/.model-cache) is missing; the eval needs the same model files as the real-model tests.');
  process.exit(1);
}

mkdirSync(CACHE, { recursive: true });
const set = flag('seed-only') ? 'seed' : flag('distractors-only') ? 'distractors' : 'both';
let distractors = '';
if (set !== 'seed') {
  distractors = join(CACHE, 'enron-spam-test.jsonl');
  if (!existsSync(distractors)) {
    console.log(`Downloading the distractor set (about 6 MB) into ${CACHE}`);
    const res = await fetch(DISTRACTOR_URL);
    if (!res.ok) {
      console.error(`Download failed: HTTP ${res.status}`);
      process.exit(1);
    }
    writeFileSync(distractors, Buffer.from(await res.arrayBuffer()));
  }
}

const out = resolve(value('out', join(CACHE, 'last-run.json')));
const env = {
  ...process.env,
  EVAL_OUT: out,
  EVAL_CACHE: CACHE,
  EVAL_SET: set,
  EVAL_DISTRACTORS: distractors,
  EVAL_RERANK: value('rerank', 'none'),
  EVAL_LABEL: value('label', 'current'),
  EVAL_EXTRA: value('extra', '') ? resolve(value('extra', '')) : '',
  EVAL_DEPTH: value('depth', ''),
  EVAL_SWEEP: value('sweep', '') ? resolve(value('sweep', '')) : '',
  EVAL_RERANK_LIMIT: value('rerank-limit', '20'),
  EVAL_RERANK_POOL: value('rerank-pool', ''),
  EMBED_MODEL: value('embed-model', ''),
  EMBED_POOLING: value('embed-pooling', ''),
  EMBED_REMOTE_CACHE: value('embed-model', '') ? join(CACHE, 'embed-models') : '',
  EVAL_QUERY_PREFIX: value('query-prefix', ''),
  EVAL_PASSAGE_PREFIX: value('passage-prefix', ''),
  ...(value('rerank-model', '') ? { RERANK_MODEL: value('rerank-model', '') } : {}),
  ...(value('rerank-tokens', '') ? { RERANK_MAX_TOKENS: value('rerank-tokens', '') } : {}),
};
const vitest = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', join(HERE, 'vitest.config.ts'), '--reporter', 'dot'], {
  cwd: ROOT, env, stdio: 'inherit',
});
if (vitest.status !== 0 || !existsSync(out)) process.exit(vitest.status ?? 1);

const { results } = JSON.parse(readFileSync(out, 'utf8'));
const pct = (x) => `${Math.round(x * 100)}`;
console.log('\n| Set | Configuration | Reranker | R@1 | R@3 | R@5 | MRR | Questions |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const s = r.summary;
  console.log(`| ${r.set} | ${r.config} | ${r.rerank === 'model' ? 'ran' : 'did not run'} | ${pct(s.r1)} | ${pct(s.r3)} | ${pct(s.r5)} | ${s.mrr.toFixed(3)} | ${s.n} |`);
}
console.log(`\nPer-question results: ${out}`);
