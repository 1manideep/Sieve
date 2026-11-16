// Emoji-only subjects: does the local embedding model match them to word queries, with and without emoji names?
import { pipeline, env } from '@huggingface/transformers';
import { readFileSync } from 'node:fs';
env.cacheDir = new URL('./.model-cache/', import.meta.url).pathname;
const byEmoji = JSON.parse(readFileSync(new URL('./node_modules/unicode-emoji-json/data-by-emoji.json', import.meta.url)));
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const named = (s) => { const n = [...seg.segment(s)].map((x) => byEmoji[x.segment]?.name ?? byEmoji[x.segment.replace(/️/g, '')]?.name).filter(Boolean); return n.length ? `${s} (${n.join(', ')})` : s; };
const ex = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const emb = async (s) => (await ex([s], { pooling: 'mean', normalize: true })).tolist()[0];
const cos = (a, b) => a.reduce((x, v, i) => x + v * b[i], 0);
const S = ['🎂🎉', '✈️🧳', '🏠🔑', '💊🩺', '🐶🐾', '🍕🍺'];
const Q = ['birthday party', 'travel luggage', 'house keys', 'medicine doctor', 'dog paws', 'pizza beer'];
let plainTop1 = 0, namedTop1 = 0;
for (let i = 0; i < S.length; i++) {
  const q = await emb(Q[i]);
  const p = await Promise.all(S.map(async (s) => cos(q, await emb(s))));
  const n = await Promise.all(S.map(async (s) => cos(q, await emb(named(s)))));
  const best = (a) => a.indexOf(Math.max(...a));
  if (best(p) === i) plainTop1++; if (best(n) === i) namedTop1++;
  console.log(`  "${Q[i]}": plain picks ${S[best(p)]}, with names picks ${S[best(n)]} (want ${S[i]})`);
}
console.log(`Emoji-only subjects: right one first ${plainTop1}/${S.length} plain, ${namedTop1}/${S.length} with emoji names`);
