#!/usr/bin/env node
// Downloads and verifies the self-hosted browser model files (11 section 5.4.3). Run by `npm run models:fetch`,
// wired into predev and prebuild. Files land in web/public/models/ and web/public/ort/, which git ignores.
// 20 section 6.5 adds the embedding model to MODELS below.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '..');

const MODELS = [
  {
    dir: 'models/rampart-b1993e4',
    base: 'https://huggingface.co/nationaldesignstudio/rampart/resolve/b1993e4e68b082835b80ffc65acc03325ea2e501',
    files: {
      'config.json': [2328, '003b84bbcd489f5e782fe5cad8f3249c3653ec880089abb1ccc398a0d895e3e6'],
      'tokenizer.json': [441954, '98ade711428b42a1b5343c403a73344535e92de8e19359cdb567ef34da210259'],
      'tokenizer_config.json': [1292, '0088a6f8bcdd4014184fb068b83ebb12896a9db2bb269a71f73de83fef24bceb'],
      'special_tokens_map.json': [695, '5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a'],
      'vocab.txt': [134750, '0fbe6b50061feabb9be68af471e9aa6df07a4bc428bdca4b0eff1fcd3612dee5'],
      'onnx/model_q4.onnx': [14693379, '9f27d24949b0581701071ea5ef522d77ccd3f50c525cc91eac4d265b0fc2afe5'],
    },
    attribution: ['LICENSE', 'MODEL_CARD.md'],   // the licence travels with the weights (CC BY 4.0)
  },
  {
    dir: 'models/Xenova/all-MiniLM-L6-v2',
    base: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9',
    files: {
      'config.json': [650, '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7'],
      'tokenizer.json': [711661, 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0'],
      'tokenizer_config.json': [366, '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3'],
      'onnx/model_quantized.onnx': [22972370, 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1'],
    },
    attribution: ['README.md'],   // Apache-2.0 model card travels with the weights (20 section 6.5)
  },
  {
    // The reranker (web/src/ml/rerank.task.ts): fp16 for WebGPU, q8 for WASM; a browser downloads only the one it runs.
    dir: 'models/Xenova/ms-marco-MiniLM-L-6-v2',
    base: 'https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/resolve/a09144355adeed5f58c8ed011d209bf8ee5a1fec',
    files: {
      'config.json': [824, 'd827779a72d27ae68cf878a6fc2e954542663fe21ca515d9f4783fc96be2d37e'],
      'tokenizer.json': [711396, 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66'],
      'tokenizer_config.json': [1242, '0b29c7bfc889e53b36d9dd3e686dd4300f6525110eaa98c76a5dafceb2029f53'],
      'onnx/model_fp16.onnx': [45609313, 'a8b79f5c22bc717c0082cb30424365f59d6689b86cfa0c4b293832acf158c66f'],
      'onnx/model_quantized.onnx': [23143499, 'e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe'],
    },
    attribution: ['README.md'],   // a conversion of cross-encoder/ms-marco-MiniLM-L-6-v2 (Apache-2.0)
  },
];
const ORT = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function present(path, size, hash) {
  try {
    if ((await stat(path)).size !== size) return false;
    return sha256(await readFile(path)) === hash;
  } catch {
    return false;
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const m of MODELS) {
  for (const [file, [size, hash]] of Object.entries(m.files)) {
    const out = join(webDir, 'public', m.dir, file);
    if (await present(out, size, hash)) continue;
    const buf = await download(`${m.base}/${file}`);
    if (buf.length !== size || sha256(buf) !== hash) {
      console.error(`fetch-models: ${m.dir}/${file} does not match the pinned size and sha256; not writing it.`);
      process.exit(1);
    }
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buf);
    console.log(`fetch-models: ${m.dir}/${file} (${size} bytes)`);
  }
  for (const file of m.attribution ?? []) {
    const out = join(webDir, 'public', m.dir, file);
    try {
      await stat(out);
    } catch {
      await writeFile(out, await download(`${m.base}/${file}`));
    }
  }
}

const ortSrc = join(repoDir, 'node_modules/@huggingface/transformers/dist');
await mkdir(join(webDir, 'public/ort'), { recursive: true });
for (const file of ORT) await copyFile(join(ortSrc, file), join(webDir, 'public/ort', file));
console.log('fetch-models: done');
