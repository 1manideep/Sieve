// Sieve spike: does local vector retrieval beat keyword search at putting the right item in
// Nano's shortlist (top 5)? Everything runs on this machine (Transformers.js, ONNX, CPU).
// Fair test: no hand-written synonyms; includes paraphrased questions whose wording does not
// appear in the target item. Compares keyword (MiniSearch + stop words), vector, and hybrid
// (reciprocal rank fusion of the two).
import MiniSearch from 'minisearch';
import { pipeline, env } from '@huggingface/transformers';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SUBJECTS, EMAILS } from '../nano/data.js';

env.cacheDir = new URL('./.model-cache/', import.meta.url).pathname;

const docs = SUBJECTS.map((s, i) => {
  const body = EMAILS.find((e) => e.subject === s.subject)?.body ?? '';
  return { id: `s${i}`, title: s.subject, from: s.from, text: body };
});
const pets = EMAILS.find((e) => e.id === 'pets');
docs.push({ id: 'doc-lease', title: pets.subject, from: '', text: pets.body });
const docText = (d) => `${d.title}. From ${d.from}. ${d.text}`.trim();

const QUESTIONS = [
  // the 12 from search_check.mjs
  { q: 'What did my landlord say about the deposit?', expect: 'Re: Deposit for the apartment' },
  { q: 'When does my flight to Seattle leave?', expect: 'Your booking is confirmed: Chicago to Seattle' },
  { q: 'Can I have a dog, and is there a fee?', expect: 'Lease_2026.pdf, section 12' },
  { q: 'What do my test results say?', expect: 'Your test results are ready to view' },
  { q: 'Find the photo where I had five hot dogs in my mouth', expect: 'Fourth of July hot dog contest pictures' },
  { q: "What's my latest bank balance?", expect: 'Your November statement is ready' },
  { q: 'When is my loan payment due?', expect: 'Loan payment due on Nov 28' },
  { q: 'Did my W-2 come?', expect: 'Your W-2 for 2025 is available' },
  { q: 'Where do I pick up the rental car?', expect: 'Your rental car pickup details' },
  { q: 'Is my prescription ready?', expect: 'Your prescription is ready for pickup' },
  { q: 'When is my next dentist appointment?', expect: 'Time to book your next cleaning' },
  { q: 'What did the doctor say?', expect: 'Your test results are ready to view' },
  // paraphrases: the key words do not appear in the target item
  { q: 'How much did I put down when I moved in?', expect: 'Re: Deposit for the apartment' },
  { q: 'Am I allowed pets in my place?', expect: 'Lease_2026.pdf, section 12' },
  { q: 'What time is my trip to Seattle?', expect: 'Your booking is confirmed: Chicago to Seattle' },
  { q: 'How much money did I send Alex?', expect: 'You paid Alex Kim $45.00' },
  { q: 'Any news from my therapist?', expect: 'Following up on our conversation' },
  { q: 'Did my headphones arrive?', expect: 'Delivered: wireless headphones' },
  { q: 'When is the inspection for leaving the apartment?', expect: 'Move-out checklist and inspection date' },
  { q: 'Is something wrong with my credit card?', expect: 'Unusual sign-in to your credit card account' },
  { q: 'Who is getting married?', expect: 'Wedding invitation: Sam & Jordan' },
  { q: 'Do I need to stop eating before my blood test?', expect: 'Fasting required before your blood draw' },
];

const STOP = new Set(('a an the my me i is are was were be been do does did what whats when where who how can could '
  + 'should would will to of in on for and or at by from with about this that it its there any some find show tell '
  + 'say said get got have has had latest next come came up much many am').split(' '));

function keywordRanker() {
  const ms = new MiniSearch({
    fields: ['title', 'from', 'text'], storeFields: ['title'],
    processTerm: (t) => (STOP.has(t) ? null : t),
    searchOptions: { boost: { title: 3, from: 2, text: 1 }, prefix: true, fuzzy: 0.2 },
  });
  ms.addAll(docs);
  return async (q) => ms.search(q).map((h) => h.id);
}

const MODELS = [
  { name: 'all-MiniLM-L6-v2', id: 'Xenova/all-MiniLM-L6-v2', pooling: 'mean', qPrefix: '', dPrefix: '' },
  { name: 'bge-small-en-v1.5', id: 'Xenova/bge-small-en-v1.5', pooling: 'cls', qPrefix: 'Represent this sentence for searching relevant passages: ', dPrefix: '' },
];

async function vectorRanker(m) {
  const t0 = performance.now();
  const extract = await pipeline('feature-extraction', m.id, { dtype: 'q8' });
  const loadMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  const dv = (await extract(docs.map((d) => m.dPrefix + docText(d)), { pooling: m.pooling, normalize: true })).tolist();
  const embedMsPerDoc = (performance.now() - t1) / docs.length;
  const rank = async (q) => {
    const [qv] = (await extract([m.qPrefix + q], { pooling: m.pooling, normalize: true })).tolist();
    return docs
      .map((d, i) => ({ id: d.id, s: dv[i].reduce((a, x, k) => a + x * qv[k], 0) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.id);
  };
  return { rank, loadMs, embedMsPerDoc, dims: dv[0].length };
}

const rrf = (lists, k = 60) => {
  const score = new Map();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};

async function evaluate(label, rank) {
  const rows = [];
  for (const { q, expect } of QUESTIONS) {
    const ids = (await rank(q)).slice(0, 5);
    const titles = ids.map((id) => docs.find((d) => d.id === id).title);
    rows.push({ q, expect, rank: titles.indexOf(expect) + 1, top: titles[0] });
  }
  const top1 = rows.filter((r) => r.rank === 1).length;
  const top5 = rows.filter((r) => r.rank >= 1).length;
  const para = rows.slice(12);
  console.log(`\n${label}: top-1 ${top1}/${rows.length}, top-5 ${top5}/${rows.length} (paraphrases: top-5 ${para.filter((r) => r.rank >= 1).length}/${para.length})`);
  for (const r of rows.filter((x) => x.rank !== 1)) console.log(`  ${r.rank ? `rank${r.rank}` : 'MISS '}  ${r.q}  -> top: ${r.top}`);
  return { label, top1, top5, total: rows.length, rows };
}

const report = [];
const kw = keywordRanker();
report.push(await evaluate('Keyword (MiniSearch + stop words, no synonyms)', kw));
for (const m of MODELS) {
  const v = await vectorRanker(m);
  console.log(`\n[${m.name}] loaded in ${v.loadMs} ms, ${v.dims} dims, ${v.embedMsPerDoc.toFixed(1)} ms per item to embed (CPU)`);
  report.push({ ...(await evaluate(`Vector ${m.name}`, v.rank)), loadMs: v.loadMs, embedMsPerDoc: v.embedMsPerDoc });
  report.push(await evaluate(`Hybrid keyword + ${m.name} (RRF)`, async (q) => rrf([await kw(q), await v.rank(q)])));
}
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/vector-${Date.now()}.json`, import.meta.url), JSON.stringify(report, null, 2));
