// Sieve spike: messy questions typed straight into Sieve (no assistant to clean them up).
// 1. Typos: does retrieval (vector, keyword with fuzzy) still find the right item?
// 2. Dates: can a standard parser (chrono-node) turn what people type into a date range,
//    and how do we handle ambiguous forms like 1-2-2026 (US vs day-first)?
import MiniSearch from 'minisearch';
import * as chrono from 'chrono-node';
import { pipeline, env } from '@huggingface/transformers';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SUBJECTS, EMAILS } from '../nano/data.js';

env.cacheDir = new URL('./.model-cache/', import.meta.url).pathname;

const docs = SUBJECTS.map((s, i) => ({ id: `s${i}`, title: s.subject, from: s.from, text: EMAILS.find((e) => e.subject === s.subject)?.body ?? '' }));
const pets = EMAILS.find((e) => e.id === 'pets');
docs.push({ id: 'doc-lease', title: pets.subject, from: '', text: pets.body });

const TYPOS = [
  { q: 'waht did my landlrod say abot the deposti', expect: 'Re: Deposit for the apartment' },
  { q: 'when does my flihgt to seatle leave', expect: 'Your booking is confirmed: Chicago to Seattle' },
  { q: 'is my precription redy', expect: 'Your prescription is ready for pickup' },
  { q: 'can i hav a dgo in my apartmnet', expect: 'Lease_2026.pdf, section 12' },
  { q: 'my credt card sign in alert', expect: 'Unusual sign-in to your credit card account' },
  { q: 'hotdog contest pics', expect: 'Fourth of July hot dog contest pictures' },
  { q: 'w2 2025', expect: 'Your W-2 for 2025 is available' },
  { q: 'tst results', expect: 'Your test results are ready to view' },
  { q: 'whos geting maried', expect: 'Wedding invitation: Sam & Jordan' },
  { q: 'rentl car pikup', expect: 'Your rental car pickup details' },
];

const STOP = new Set('a an the my me i is are was were be do does did what whats waht when where who how can to of in on for and or at by from with about abot it any some'.split(' '));
const ms = new MiniSearch({ fields: ['title', 'from', 'text'], storeFields: ['title'], processTerm: (t) => (STOP.has(t) ? null : t), searchOptions: { boost: { title: 3, from: 2, text: 1 }, prefix: true, fuzzy: 0.2 } });
ms.addAll(docs);

const extract = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const dv = (await extract(docs.map((d) => `${d.title}. From ${d.from}. ${d.text}`), { pooling: 'mean', normalize: true })).tolist();
const vrank = async (q) => {
  const [qv] = (await extract([q], { pooling: 'mean', normalize: true })).tolist();
  return docs.map((d, i) => ({ t: d.title, s: dv[i].reduce((a, x, k) => a + x * qv[k], 0) })).sort((a, b) => b.s - a.s).map((x) => x.t);
};

const typoRows = [];
for (const { q, expect } of TYPOS) {
  const kw = ms.search(q).map((h) => h.title).slice(0, 5);
  const vec = (await vrank(q)).slice(0, 5);
  const union = [...new Set([...vec, ...kw.slice(0, 2)])];
  typoRows.push({ q, expect, keyword: kw.indexOf(expect) + 1, vector: vec.indexOf(expect) + 1, shortlist: union.includes(expect) });
}
const count = (k) => typoRows.filter((r) => r[k] >= 1 || r[k] === true).length;
console.log(`TYPOS: keyword top-5 ${count('keyword')}/${TYPOS.length}, vector top-5 ${count('vector')}/${TYPOS.length}, shortlist (vector 5 + keyword 2) ${count('shortlist')}/${TYPOS.length}`);
for (const r of typoRows.filter((x) => !x.shortlist || x.vector !== 1)) console.log(`  "${r.q}": keyword rank ${r.keyword || 'miss'}, vector rank ${r.vector || 'miss'}`);

// Fix: correct spelling against the index's own vocabulary (words that appear in the person's
// items), with a Damerau-Levenshtein distance of 1 for short words and 2 for longer ones.
const vocab = new Map();
for (const d of docs) for (const w of `${d.title} ${d.from} ${d.text}`.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? []) vocab.set(w, (vocab.get(w) ?? 0) + 1);
function osa(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function correct(q) {
  const fixes = [];
  const out = q.toLowerCase().replace(/[a-z][a-z0-9-]*/g, (w) => {
    if (vocab.has(w) || STOP.has(w) || w.length < 3) return w;
    const max = w.length <= 4 ? 1 : 2;
    let best = null; let bestD = max + 1; let bestF = 0;
    for (const [v, f] of vocab) {
      if (Math.abs(v.length - w.length) > max) continue;
      const dist = osa(w, v);
      if (dist < bestD || (dist === bestD && f > bestF)) { best = v; bestD = dist; bestF = f; }
    }
    if (best && bestD <= max) { fixes.push(`${w}->${best}`); return best; }
    return w;
  });
  return { text: out, fixes };
}
const fixedRows = [];
for (const { q, expect } of TYPOS) {
  const c = correct(q);
  const kw = ms.search(c.text).map((h) => h.title).slice(0, 5);
  const vec = (await vrank(c.text)).slice(0, 5);
  const union = [...new Set([...vec, ...kw.slice(0, 2)])];
  fixedRows.push({ q, corrected: c.text, fixes: c.fixes, vector: vec.indexOf(expect) + 1, shortlist: union.includes(expect) });
}
console.log(`WITH SPELLING FIXED FROM THE INDEX'S OWN WORDS: shortlist ${fixedRows.filter((r) => r.shortlist).length}/${TYPOS.length}, vector top-1 ${fixedRows.filter((r) => r.vector === 1).length}/${TYPOS.length}`);
for (const r of fixedRows) console.log(`  ${r.shortlist ? 'ok  ' : 'MISS'} "${r.q}" -> "${r.corrected}"`);

// Dates. Reference "now" fixed so the output is reproducible.
const now = new Date('2026-11-16T10:00:00');
const DATES = ['emails from 1-2-2026', 'the receipt from 12/04', 'what did the doctor send last month', 'photos from July 4th',
  'anything from two weeks ago', 'the bill due Nov 28', 'messages since yesterday', 'the flight on dec 4th at 7:45',
  'stuff from 3/3/26', 'the email on 2026-03-03', 'between march 1 and march 15', 'from the 4th of july', 'last week'];
const fmt = (d) => (d ? d.toISOString().slice(0, 10) : '');
const dateRows = DATES.map((text) => {
  const us = chrono.en.parse(text, now, { forwardDate: false });
  const gb = chrono.en.GB.parse(text, now, { forwardDate: false });
  const pick = (r) => (r[0] ? { matched: r[0].text, start: fmt(r[0].start?.date()), end: fmt(r[0].end?.date()), certainDay: r[0].start?.isCertain('day'), certainMonth: r[0].start?.isCertain('month'), certainYear: r[0].start?.isCertain('year') } : null);
  return { text, us: pick(us), dayFirst: pick(gb), ambiguous: !!(us[0] && gb[0] && fmt(us[0].start.date()) !== fmt(gb[0].start.date())) };
});
console.log('\nDATES (US reading | day-first reading):');
for (const r of dateRows) {
  const u = r.us ? `${r.us.start}${r.us.end ? ' to ' + r.us.end : ''} ("${r.us.matched}")` : 'not found';
  const g = r.dayFirst ? `${r.dayFirst.start}${r.dayFirst.end ? ' to ' + r.dayFirst.end : ''}` : 'not found';
  console.log(`  ${r.text.padEnd(40)} ${u}${r.ambiguous ? `  | day-first: ${g}  AMBIGUOUS` : ''}${r.us && !r.us.certainYear ? '  (year implied)' : ''}`);
}

mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/messy-input-${Date.now()}.json`, import.meta.url), JSON.stringify({ typoRows, fixedRows, dateRows }, null, 2));
