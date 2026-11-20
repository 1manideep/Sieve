// The thin date layer in front of chrono-node (20 section 9.3): numeric pre-pass, periods, ranges,
// word-month and relative forms, implied years. All dates are local calendar days, 'YYYY-MM-DD', inclusive.
import * as chrono from 'chrono-node';

export interface Interpreted { text: string; as: string; ambiguous: boolean }
export interface DateHint { after?: string; before?: string; interpreted: Interpreted[] }

type Kind = 'day' | 'range' | 'month';
interface Found {
  index: number; end: number; text: string; kind: Kind;
  start: Date; last: Date;            // inclusive local days
  ambiguous: boolean;
}

const DAY_MS = 86_400_000;
const FUTURE_WORDS = /\b(upcoming|next|will|coming|due|leave|leaves|leaving|depart|departs|departure|arrive|arrives|arriving|scheduled|tomorrow)\b/i;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1 };
const NUM = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)';

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function day(y: number, m: number, d: number): Date {
  return new Date(y, m, d);
}

function startOfDay(d: Date): Date {
  return day(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return day(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = day(y, m - 1, d);
  return t.getMonth() === m - 1 && t.getDate() === d;
}

/** Day before month in this locale's numeric dates (en-US false, en-GB true). */
export function dayFirst(locale: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(2006, 10, 22));
    const di = parts.findIndex((p) => p.type === 'day');
    const mi = parts.findIndex((p) => p.type === 'month');
    return di >= 0 && mi >= 0 && di < mi;
  } catch {
    return false;
  }
}

function blank(s: string, index: number, length: number): string {
  return s.slice(0, index) + ' '.repeat(length) + s.slice(index + length);
}

/** Resolve a month and day without a year: most recent on or before today, or nearest on or after with future words. */
function impliedDay(m: number, d: number, now: Date, future: boolean): Date | null {
  const today = startOfDay(now);
  const y = now.getFullYear();
  const cands = [y - 1, y, y + 1].filter((yy) => valid(yy, m, d)).map((yy) => day(yy, m - 1, d));
  if (cands.length === 0) return null;
  if (future) return cands.find((c) => c >= today) ?? cands[cands.length - 1] ?? null;
  return [...cands].reverse().find((c) => c <= today) ?? cands[0] ?? null;
}

function impliedMonth(m: number, now: Date, future: boolean): Date {
  const today = startOfDay(now);
  const y = now.getFullYear();
  const cands = [y - 1, y, y + 1].map((yy) => day(yy, m - 1, 1));
  if (future) return cands.find((c) => day(c.getFullYear(), c.getMonth() + 1, 0) >= today) ?? (cands[2] as Date);
  return [...cands].reverse().find((c) => c <= today) ?? (cands[0] as Date);
}

/** The occurrence nearest a reference date (mentioned dates: within 183 days of the item's own date). */
function nearestDay(m: number, d: number, ref: Date): Date | null {
  const y = ref.getFullYear();
  let best: Date | null = null;
  for (const yy of [y - 1, y, y + 1]) {
    if (!valid(yy, m, d)) continue;
    const c = day(yy, m - 1, d);
    if (!best || Math.abs(c.getTime() - ref.getTime()) < Math.abs(best.getTime() - ref.getTime())) best = c;
  }
  if (best && Math.abs(best.getTime() - ref.getTime()) > 183 * DAY_MS) return null;
  return best;
}

interface NumericOpts { locale: string; flip?: string[]; now: Date; future: boolean; forMentions?: boolean }

/** Step 1: numeric dates. Returns found items and the text with matched spans blanked. */
function numericPass(text: string, o: NumericOpts): { found: Found[]; rest: string } {
  const found: Found[] = [];
  let rest = text;
  const df = dayFirst(o.locale);
  const flip = new Set(o.flip ?? []);
  const notDateContext = (idx: number, len: number) => text[idx - 1] === '$' || text[idx + len] === '%' || /\d/.test(text[idx - 1] ?? '') || /\d/.test(text[idx + len] ?? '');

  for (const m of text.matchAll(/\b(\d{4})([-/.])(\d{1,2})\2(\d{1,2})\b/g)) {
    if (notDateContext(m.index, m[0].length)) continue;
    const y = Number(m[1]), mo = Number(m[3]), d = Number(m[4]);
    if (!valid(y, mo, d)) continue;
    const dt = day(y, mo - 1, d);
    found.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'day', start: dt, last: dt, ambiguous: false });
    rest = blank(rest, m.index, m[0].length);
  }
  for (const m of rest.matchAll(/\b(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})\b/g)) {
    if (notDateContext(m.index, m[0].length)) continue;
    const a = Number(m[1]), b = Number(m[3]);
    let y = Number(m[4]);
    if ((m[4] ?? '').length === 2) y += 2000;
    const dots = m[2] === '.';             // 70 R-IN-11: dotted dates are always day first, never ambiguous
    let first = dots ? !flip.has(m[0]) : df !== flip.has(m[0]);   // true: day first
    let ambiguous = !dots && a <= 12 && b <= 12 && a !== b;
    let [mo, d] = first ? [b, a] : [a, b];
    if (!valid(y, mo, d)) {
      first = !first;
      [mo, d] = first ? [b, a] : [a, b];
      if (!valid(y, mo, d)) continue;
      ambiguous = false;
    }
    if (o.forMentions && ambiguous) {
      rest = blank(rest, m.index, m[0].length);
      continue;
    }
    const dt = day(y, mo - 1, d);
    found.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'day', start: dt, last: dt, ambiguous });
    rest = blank(rest, m.index, m[0].length);
  }
  for (const m of rest.matchAll(/\b(\d{1,2})\/(\d{1,2})\b(?!\/\d)/g)) {
    if (notDateContext(m.index, m[0].length)) continue;
    const a = Number(m[1]), b = Number(m[2]);
    let first = df !== flip.has(m[0]);
    let ambiguous = a <= 12 && b <= 12 && a !== b;
    let [mo, d] = first ? [b, a] : [a, b];
    const resolve = (mm: number, dd: number) => (o.forMentions ? nearestDay(mm, dd, o.now) : impliedDay(mm, dd, o.now, o.future));
    let dt = valid(2024, mo, d) ? resolve(mo, d) : null;
    if (!dt) {
      first = !first;
      [mo, d] = first ? [b, a] : [a, b];
      dt = valid(2024, mo, d) ? resolve(mo, d) : null;
      if (!dt) continue;
      ambiguous = false;
    }
    if (o.forMentions && ambiguous) {
      rest = blank(rest, m.index, m[0].length);
      continue;
    }
    found.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'day', start: dt, last: dt, ambiguous });
    rest = blank(rest, m.index, m[0].length);
  }
  return { found, rest };
}

function mondayOf(d: Date): Date {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7));
}

function thanksgiving(y: number): Date {
  const first = day(y, 10, 1);
  const offset = (4 - first.getDay() + 7) % 7;   // first Thursday
  return day(y, 10, 1 + offset + 21);
}

const SEASONS: Record<string, [number, number]> = { spring: [2, 4], summer: [5, 7], fall: [8, 10], autumn: [8, 10], winter: [11, 13] };

function seasonRange(name: string, which: 'this' | 'last', now: Date): [Date, Date] {
  const [m0, m1] = SEASONS[name] ?? [5, 7];
  const today = startOfDay(now);
  const span = (y: number): [Date, Date] => [day(y, m0, 1), day(y, m1 + 1, 0)];
  const y = now.getFullYear();
  const cands = [span(y - 2), span(y - 1), span(y), span(y + 1)];
  if (which === 'last') return [...cands].reverse().find(([, e]) => e < today) ?? (cands[0] as [Date, Date]);
  const containing = cands.find(([s, e]) => s <= today && today <= e);
  if (containing) return containing;
  // this <season> outside it: winter means the coming one; the others the one of this calendar year
  if (name === 'winter') return cands.find(([s]) => s > today) ?? (cands[2] as [Date, Date]);
  return span(y);
}

/** Step 2: periods and holidays (own rules, before chrono). */
function periodPass(text: string, now: Date, future: boolean): { found: Found[]; rest: string } {
  const found: Found[] = [];
  let rest = text;
  const today = startOfDay(now);
  const add = (m: RegExpMatchArray, kind: Kind, start: Date, last: Date) => {
    const index = m.index ?? 0;
    found.push({ index, end: index + m[0].length, text: m[0], kind, start, last, ambiguous: false });
    rest = blank(rest, index, m[0].length);
  };
  const lower = () => rest.toLowerCase();
  const n = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s);

  const rules: [RegExp, (m: RegExpMatchArray) => void][] = [
    [new RegExp(`\\b(?:in the |within the )?(?:last|past) ${NUM} (day|week|month|year)s?\\b`, 'gi'), (m) => {
      const k = n(m[1] ?? '1');
      const unit = (m[2] ?? 'day').toLowerCase();
      const s = unit === 'day' ? addDays(today, -k) : unit === 'week' ? addDays(today, -7 * k) : unit === 'month' ? day(today.getFullYear(), today.getMonth() - k, today.getDate()) : day(today.getFullYear() - k, today.getMonth(), today.getDate());
      add(m, 'range', s, today);
    }],
    [new RegExp(`\\b${NUM} (day|week|month|year)s? ago\\b`, 'gi'), (m) => {
      const k = n(m[1] ?? '1');
      const unit = (m[2] ?? 'day').toLowerCase();
      if (unit === 'day') {
        const c = addDays(today, -k);
        add(m, 'range', addDays(c, -1), addDays(c, 1));
      } else if (unit === 'week') {
        const c = addDays(today, -7 * k);
        add(m, 'range', addDays(c, -3), addDays(c, 3));
      } else if (unit === 'month') {
        const s = day(today.getFullYear(), today.getMonth() - k, 1);
        add(m, 'month', s, day(s.getFullYear(), s.getMonth() + 1, 0));
      } else {
        const y = today.getFullYear() - k;
        add(m, 'range', day(y, 0, 1), day(y, 11, 31));
      }
    }],
    [/\btoday\b/gi, (m) => add(m, 'day', today, today)],
    [/\byesterday\b/gi, (m) => { const d = addDays(today, -1); add(m, 'day', d, d); }],
    [/\bthis week\b/gi, (m) => add(m, 'range', mondayOf(today), today)],
    [/\blast week\b/gi, (m) => { const s = addDays(mondayOf(today), -7); add(m, 'range', s, addDays(s, 6)); }],
    [/\bthis weekend\b/gi, (m) => { const s = addDays(mondayOf(today), 5); add(m, 'range', s, addDays(s, 1)); }],
    [/\blast weekend\b/gi, (m) => { const s = addDays(mondayOf(today), -2); add(m, 'range', s, addDays(s, 1)); }],
    [/\bthis month\b/gi, (m) => add(m, 'month', day(today.getFullYear(), today.getMonth(), 1), day(today.getFullYear(), today.getMonth() + 1, 0))],
    [/\blast month\b/gi, (m) => add(m, 'month', day(today.getFullYear(), today.getMonth() - 1, 1), day(today.getFullYear(), today.getMonth(), 0))],
    [/\bthis year\b/gi, (m) => add(m, 'range', day(today.getFullYear(), 0, 1), day(today.getFullYear(), 11, 31))],
    [/\blast year\b/gi, (m) => add(m, 'range', day(today.getFullYear() - 1, 0, 1), day(today.getFullYear() - 1, 11, 31))],
    [/\b(this|last) (summer|winter|spring|fall|autumn)\b/gi, (m) => {
      const [s, e] = seasonRange((m[2] ?? 'summer').toLowerCase(), (m[1] ?? 'this').toLowerCase() as 'this' | 'last', now);
      add(m, 'range', s, e);
    }],
  ];
  for (const [re, fn] of rules) for (const m of [...lower().matchAll(re)]) fn(m);

  const holidays: [RegExp, (y: number) => Date][] = [
    [/\bchristmas\b/gi, (y) => day(y, 11, 25)],
    [/\bnew year'?s?(?: day| eve)?\b/gi, (y) => day(y, 0, 1)],
    [/\bhalloween\b/gi, (y) => day(y, 9, 31)],
    [/\bvalentine'?s?(?: day)?\b/gi, (y) => day(y, 1, 14)],
    [/\bthanksgiving\b/gi, (y) => thanksgiving(y)],
    [/\b(?:independence day|(?:the )?(?:4th|fourth) of july)\b/gi, (y) => day(y, 6, 4)],
  ];
  for (const [re, at] of holidays) {
    for (const m of [...lower().matchAll(re)]) {
      const y = now.getFullYear();
      const cands = [at(y - 1), at(y), at(y + 1)];
      const pick = future ? cands.find((c) => c >= today) : [...cands].reverse().find((c) => c <= today);
      const c = pick ?? at(y);
      add(m, 'range', addDays(c, -1), addDays(c, 1));
    }
  }
  return { found, rest };
}

/** Step 4: chrono for word months and relative forms (default English casual parser, never en.GB). */
function chronoPass(text: string, now: Date, future: boolean, forMentions: boolean): Found[] {
  const out: Found[] = [];
  let results: chrono.ParsedResult[];
  try {
    results = chrono.casual.parse(text, now, { forwardDate: false });
  } catch {
    return out;
  }
  for (const r of results) {
    const s = r.start;
    const certainDay = s.isCertain('day');
    const certainMonth = s.isCertain('month');
    const weekday = s.isCertain('weekday');
    if (!certainDay && !certainMonth && !weekday) continue;   // a time alone ("7:45") is not a date
    if (forMentions && !(certainDay && certainMonth)) continue;
    const base = { index: r.index, end: r.index + r.text.length, text: r.text, ambiguous: false };
    const resolve = (c: chrono.ParsedComponents): Date | null => {
      const m = c.get('month') ?? 1;
      const d = c.get('day') ?? 1;
      if (c.isCertain('year')) return day(c.get('year') ?? now.getFullYear(), m - 1, d);
      if (c.isCertain('month') && c.isCertain('day')) return forMentions ? nearestDay(m, d, now) : impliedDay(m, d, now, future);
      return startOfDay(c.date());
    };
    if (!certainDay && certainMonth && !r.end) {
      const m = s.get('month') ?? 1;
      const st = s.isCertain('year') ? day(s.get('year') ?? now.getFullYear(), m - 1, 1) : impliedMonth(m, now, future);
      out.push({ ...base, kind: 'month', start: st, last: day(st.getFullYear(), st.getMonth() + 1, 0) });
      continue;
    }
    const st = resolve(s);
    if (!st) continue;
    if (r.end) {
      let en = resolve(r.end) ?? st;
      if (en < st) en = day(en.getFullYear() + 1, en.getMonth(), en.getDate());
      out.push({ ...base, kind: 'range', start: st, last: en });
    } else {
      out.push({ ...base, kind: 'day', start: st, last: st });
    }
  }
  return out;
}

function asText(f: Found): string {
  return f.kind === 'day' ? iso(f.start) : `${iso(f.start)}..${iso(f.last)}`;
}

/** Step 3: pair dates into ranges and apply since/after/before/until. */
function combine(text: string, items: Found[]): { range?: [Date, Date]; first?: Found; extra: Interpreted[] } {
  const sorted = [...items].sort((a, b) => a.index - b.index);
  const lower = text.toLowerCase();
  const extra: Interpreted[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i] as Found;
    const b = sorted[i + 1] as Found;
    const between = lower.slice(a.end, b.index);
    const before = lower.slice(Math.max(0, a.index - 9), a.index);
    const joined = /^\s*(and|to|until|through|thru|-|–)\s*$/.test(between);
    if (!joined) continue;
    const opener = /\b(between|from)\s*$/.test(before);
    if (/^\s*and\s*$/.test(between) && !opener) continue;
    let last = b.last;
    if (last < a.start) last = day(last.getFullYear() + 1, last.getMonth(), last.getDate());
    extra.push({ text: text.slice(opener ? a.index - (before.match(/(between|from)\s*$/)?.[0].length ?? 0) : a.index, b.end).trim(), as: `${iso(a.start)}..${iso(last)}`, ambiguous: a.ambiguous || b.ambiguous });
    return { range: [a.start, last], first: a, extra };
  }
  const first = sorted[0];
  if (!first) return { extra };
  const lead = lower.slice(Math.max(0, first.index - 7), first.index);
  const word = /\b(since|after|before|until|till)\s*$/.exec(lead)?.[1];
  if (word === 'since') return { range: [first.start, new Date(8.64e15)], first, extra };
  if (word === 'after') return { range: [addDays(first.last, 1), new Date(8.64e15)], first, extra };
  if (word === 'before') return { range: [new Date(-8.64e15), addDays(first.start, -1)], first, extra };
  if (word === 'until' || word === 'till') return { range: [new Date(-8.64e15), first.last], first, extra };
  return { range: [first.start, first.last], first, extra };
}

/** Dates in a question (20 section 9.3). `flip` lists numeric dates the person flipped to the other order. */
export function parseDates(text: string, now: Date, locale: string, flip?: string[]): DateHint {
  const future = FUTURE_WORDS.test(text);
  const num = numericPass(text, { locale, flip, now, future });
  const per = periodPass(num.rest, now, future);
  const chr = chronoPass(per.rest, now, future, false);
  const all = [...num.found, ...per.found, ...chr];
  const interpreted: Interpreted[] = all.sort((a, b) => a.index - b.index).map((f) => ({ text: f.text, as: asText(f), ambiguous: f.ambiguous }));
  if (all.length === 0) return { interpreted: [] };
  const { range, extra } = combine(text, all);
  const hint: DateHint = { interpreted: [...interpreted, ...extra] };
  if (range) {
    const [s, e] = range;
    if (s.getTime() > -8e15) hint.after = iso(s);
    if (e.getTime() < 8e15) hint.before = iso(e);
  }
  return hint;
}

/** Days an item's text mentions (ingest, 20 section 12.1): numeric and word-month dates near the item's date. */
export function mentionedDays(text: string, itemDate: number, locale: string): string[] {
  const src = text.slice(0, 20_000);
  if (!src.trim()) return [];
  const ref = new Date(itemDate);
  const num = numericPass(src, { locale, now: ref, future: false, forMentions: true });
  const chr = chronoPass(num.rest, ref, false, true);
  const out: string[] = [];
  for (const f of [...num.found, ...chr].sort((a, b) => a.index - b.index)) {
    for (const d of f.kind === 'range' ? [f.start, f.last] : [f.start]) {
      const s = iso(d);
      if (!out.includes(s)) out.push(s);
      if (out.length >= 30) return out;
    }
  }
  return out;
}
