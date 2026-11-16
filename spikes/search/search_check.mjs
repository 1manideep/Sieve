// Sieve spike: does a plain keyword index put the right item in the top 5 (TOP_K) for
// realistic questions? Runs in Node with MiniSearch on the spike's made-up data. Compares
// (A) MiniSearch defaults with (B) stop words + a small synonym map, because people ask
// "my landlord" while the mail says "Oakview Property Management".
import MiniSearch from 'minisearch';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SUBJECTS, EMAILS } from '../nano/data.js';

const docs = SUBJECTS.map((s, i) => {
  const body = EMAILS.find((e) => e.subject === s.subject)?.body ?? '';
  return { id: `s${i}`, title: s.subject, from: s.from, text: body, label: s.label };
});
// The lease section is a document, not an email subject.
const pets = EMAILS.find((e) => e.id === 'pets');
docs.push({ id: 'doc-lease', title: pets.subject, from: '', text: pets.body, label: 'Home' });

const QUESTIONS = [
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
];

const STOP = new Set(('a an the my me i is are was were be been do does did what whats when where who how can could '
  + 'should would will to of in on for and or at by from with about this that it its there any some find show tell '
  + 'say said get got have has had latest next come came up').split(' '));

const SYNONYMS = {
  landlord: ['property', 'management', 'lease', 'rent', 'apartment'],
  photo: ['pictures', 'photos', 'picture'], picture: ['pictures', 'photos', 'photo'],
  dog: ['pets', 'pet'], cat: ['pets', 'pet'],
  balance: ['statement'], bank: ['statement'],
  flight: ['booking', 'check'],
  doctor: ['medical', 'appointment', 'results', 'care'],
  dentist: ['dental', 'cleaning'],
  car: ['rental'],
};

function tokenizeB(text) {
  const base = text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9-]+/).filter((t) => t && !STOP.has(t));
  return base.flatMap((t) => [t, ...(SYNONYMS[t] ?? [])]);
}

function build(config) {
  const ms = new MiniSearch({
    fields: ['title', 'from', 'text'],
    storeFields: ['title', 'from', 'label'],
    ...(config === 'B' ? { processTerm: (t) => (STOP.has(t) ? null : t) } : {}),
    searchOptions: { boost: { title: 3, from: 2, text: 1 }, prefix: true, fuzzy: 0.2 },
  });
  ms.addAll(docs);
  return ms;
}

function run(config) {
  const ms = build(config);
  return QUESTIONS.map(({ q, expect }) => {
    const query = config === 'B' ? tokenizeB(q).join(' ') : q;
    const hits = ms.search(query).slice(0, 5);
    const rank = hits.findIndex((h) => h.title === expect) + 1;
    return { q, expect, rank, top: hits.map((h) => h.title) };
  });
}

const report = {};
for (const config of ['A', 'B']) {
  const rows = run(config);
  const top1 = rows.filter((r) => r.rank === 1).length;
  const top5 = rows.filter((r) => r.rank >= 1).length;
  report[config] = { top1, top5, total: rows.length, rows };
  console.log(`\n${config === 'A' ? 'A: MiniSearch defaults' : 'B: stop words + synonyms'}: top-1 ${top1}/${rows.length}, in top 5 ${top5}/${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.rank === 1 ? 'top1' : r.rank ? `rank${r.rank}` : 'MISS'}  ${r.q}${r.rank === 1 ? '' : `  -> got: ${r.top[0] ?? 'nothing'}`}`);
  }
}
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/search-${Date.now()}.json`, import.meta.url), JSON.stringify(report, null, 2));
