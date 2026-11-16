// Sieve spike: the thin date layer on top of chrono-node (00 section 10, D7; 20 parseQuestion).
// Rules: numeric dates use the locale's order and are flagged ambiguous when both parts <= 12 and differ;
// implied years resolve to the most recent past date unless the question has future words;
// periods become ranges (last month, last week, in July, this year); "between X and Y" / "from X to Y" are ranges.
import * as chrono from 'chrono-node';
import { writeFileSync, mkdirSync } from 'node:fs';

const FUTURE = /\b(upcoming|next|will|coming|tomorrow|later)\b/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (y, m, d) => new Date(y, m, d);

export function parseDates(q, now, locale = 'en-US') {
  const out = { after: null, before: null, interpreted: [] };
  const dayFirst = !/^en-(US|PH)$/i.test(locale) && locale.toLowerCase() !== 'en';
  const futureWords = FUTURE.test(q);
  const pastYear = (d) => (!futureWords && d > now ? day(d.getFullYear() - 1, d.getMonth(), d.getDate()) : d);

  // 1. numeric pre-pass: 1-2-2026, 3/3/26, 12/04, 2026-03-03
  const isoM = q.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoM) {
    const d = day(+isoM[1], +isoM[2] - 1, +isoM[3]);
    out.after = out.before = iso(d); out.interpreted.push({ text: isoM[0], as: iso(d), ambiguous: false });
    return out;
  }
  const num = q.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if (num) {
    let [a, b] = [+num[1], +num[2]];
    let y = num[3] ? +num[3] : null; if (y !== null && y < 100) y += 2000;
    const [m, d] = dayFirst ? [b, a] : [a, b];
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    let date = day(y ?? now.getFullYear(), m - 1, d);
    if (y === null) date = pastYear(date);
    out.after = out.before = iso(date);
    out.interpreted.push({ text: num[0], as: iso(date), ambiguous, alternative: ambiguous ? iso(y === null ? pastYear(day(now.getFullYear(), d - 1, m)) : day(y, d - 1, m)) : undefined });
    return out;
  }
  // 2. periods
  const lower = q.toLowerCase();
  if (/\blast month\b/.test(lower)) { const s = day(now.getFullYear(), now.getMonth() - 1, 1); const e = day(now.getFullYear(), now.getMonth(), 0); return { after: iso(s), before: iso(e), interpreted: [{ text: 'last month', as: `${iso(s)} to ${iso(e)}`, ambiguous: false }] }; }
  if (/\blast week\b/.test(lower)) { const dow = (now.getDay() + 6) % 7; const s = day(now.getFullYear(), now.getMonth(), now.getDate() - dow - 7); const e = day(s.getFullYear(), s.getMonth(), s.getDate() + 6); return { after: iso(s), before: iso(e), interpreted: [{ text: 'last week', as: `${iso(s)} to ${iso(e)}`, ambiguous: false }] }; }
  const inMonth = lower.match(new RegExp(`\\bin (${MONTHS.join('|')})\\b`));
  if (inMonth) { const m = MONTHS.indexOf(inMonth[1]); let s = day(now.getFullYear(), m, 1); if (!futureWords && s > now) s = day(now.getFullYear() - 1, m, 1); const e = day(s.getFullYear(), m + 1, 0); return { after: iso(s), before: iso(e), interpreted: [{ text: inMonth[0], as: `${iso(s)} to ${iso(e)}`, ambiguous: false }] }; }
  // 3. ranges: between X and Y / from X to Y
  const range = lower.match(/\b(?:between|from)\s+(.+?)\s+(?:and|to|until)\s+(.+?)(?:[?.!,]|$)/);
  if (range) {
    const a = chrono.en.parseDate(range[1], now); const b = chrono.en.parseDate(range[2], now);
    if (a && b) { const s = pastYear(a); let e = pastYear(b); if (e < s) e = day(e.getFullYear() + 1, e.getMonth(), e.getDate()); return { after: iso(s), before: iso(e), interpreted: [{ text: range[0].trim(), as: `${iso(s)} to ${iso(e)}`, ambiguous: false }] }; }
  }
  // 4. everything else: chrono for word months and relative forms, with past preference
  const r = chrono.en.parse(q, now, { forwardDate: futureWords })[0];
  if (r) {
    let s = r.start.date(); if (!r.start.isCertain('year')) s = pastYear(s);
    const e = r.end ? r.end.date() : s;
    out.after = iso(s); out.before = iso(e); out.interpreted.push({ text: r.text, as: r.end ? `${iso(s)} to ${iso(e)}` : iso(s), ambiguous: false });
  }
  return out;
}

const now = new Date('2026-11-16T10:00:00');
const CASES = [
  ['emails from 1-2-2026', '2026-01-02', '2026-01-02', true],
  ['the receipt from 12/04', '2025-12-04', '2025-12-04', true],
  ['what did the doctor send last month', '2026-10-01', '2026-10-31', false],
  ['photos from July 4th', '2026-07-04', '2026-07-04', false],
  ['anything from two weeks ago', '2026-11-02', '2026-11-02', false],
  ['the bill due Nov 28', '2025-11-28', '2025-11-28', false],
  ['my upcoming flight on dec 4th', '2026-12-04', '2026-12-04', false],
  ['messages since yesterday', '2026-11-15', '2026-11-15', false],
  ['stuff from 3/3/26', '2026-03-03', '2026-03-03', false],
  ['the email on 2026-03-03', '2026-03-03', '2026-03-03', false],
  ['between march 1 and march 15', '2026-03-01', '2026-03-15', false],
  ['what came in july', '2026-07-01', '2026-07-31', false],
  ['last week', '2026-11-09', '2026-11-15', false],
];
// "the bill due Nov 28": with no future word, the most recent past Nov 28 is 2025; a person asking on Nov 16
// about a bill due in 12 days would say "upcoming"/"next", or the hint only boosts (it never filters), so the
// 2026 email still ranks by meaning. Counted as expected-past here on purpose.
let pass = 0;
const rows = CASES.map(([q, a, b, amb]) => {
  const r = parseDates(q, now, 'en-US');
  const ok = r.after === a && r.before === b && (r.interpreted[0]?.ambiguous ?? false) === amb;
  if (ok) pass++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${q.padEnd(38)} -> ${r.after} to ${r.before}${r.interpreted[0]?.ambiguous ? `  (ambiguous; other reading ${r.interpreted[0].alternative})` : ''}${ok ? '' : `   want ${a} to ${b}`}`);
  return { q, want: [a, b, amb], got: r, ok };
});
console.log(`\nDate layer: ${pass}/${CASES.length} as intended (chrono alone got about 6/13 right in messy_input_check.mjs)`);
const gb = parseDates('emails from 1-2-2026', now, 'en-GB');
console.log(`Day-first locale reads 1-2-2026 as ${gb.after} (ambiguous: ${gb.interpreted[0].ambiguous})`);
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/date-layer-${Date.now()}.json`, import.meta.url), JSON.stringify({ pass, total: CASES.length, rows }, null, 2));
