// The thin date layer in front of chrono-node (20 section 9.3): numeric pre-pass, periods, ranges,
// word-month and relative forms, implied years. All dates are local calendar days, 'YYYY-MM-DD', inclusive.
import * as chrono from 'chrono-node';

export interface Interpreted { text: string; as: string; ambiguous: boolean }
/**
 * `explicit`: the person wrote the date out with its year ("November 13, 2026", "2026-11-13", "October 2026"), so
 * search may filter by it. Every other date (a month and day without a year, a weekday, "last week", a holiday) is
 * Sieve's reading of loose words, and search only ranks by it (Nov 21, 2026: guessed dates as filters removed the
 * answer for 6 of 40 questions, docs/research/local-vector-search.md section 2.1).
 */
export interface DateHint { after?: string; before?: string; interpreted: Interpreted[]; explicit: boolean }

type Kind = 'day' | 'range' | 'month';
interface Found {
  index: number; end: number; text: string; kind: Kind;
  start: Date; last: Date;            // inclusive local days
  ambiguous: boolean;
  explicit: boolean;                  // the year was written, and the reading has only one choice
}

/** Which way a date without a year points: from the question's words, or either way when nothing says. */
type Tense = 'future' | 'past' | 'either';

const DAY_MS = 86_400_000;
const FUTURE_WORDS = /\b(upcoming|next|will|coming|due|leave|leaves|leaving|depart|departs|departure|arrive|arrives|arriving|scheduled|tomorrow)\b/i;
/** "emails from Nov 28", "since March 3": the item's own date, which is never in the future. */
const PAST_LEAD = /\b(from|since)\s*$/i;
/**
 * A month and day without a year, with nothing in the question saying which way: the coming one when it is nearer
 * and at most this many days ahead, else the past one. Mail mentions bookings, bills and appointments a few weeks
 * ahead ("What do I have going on December 4?" on Nov 17), but rarely a date most of a year ahead (Nov 21, 2026).
 */
const LOOKAHEAD_DAYS = 90;
const OPEN_START = new Date(-8.64e15);
const OPEN_END = new Date(8.64e15);
const WRITTEN_YEAR = /\b(19|20)\d{2}\b/;
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

/** Past or coming, by LOOKAHEAD_DAYS: how far back the past one ended and how far ahead the coming one starts. */
function pickSide(tense: Tense, daysBack: number, daysAhead: number): 'past' | 'coming' {
  if (tense === 'future') return 'coming';
  if (tense === 'past') return 'past';
  return daysAhead <= LOOKAHEAD_DAYS && daysAhead < daysBack ? 'coming' : 'past';
}

/** Resolve a month and day without a year: the past or the coming occurrence (today counts as both). */
function impliedDay(m: number, d: number, now: Date, tense: Tense): Date | null {
  const today = startOfDay(now);
  const y = now.getFullYear();
  const cands = [y - 1, y, y + 1].filter((yy) => valid(yy, m, d)).map((yy) => day(yy, m - 1, d));
  if (cands.length === 0) return null;
  const past = [...cands].reverse().find((c) => c <= today);
  const coming = cands.find((c) => c >= today);
  if (!past || !coming) return past ?? coming ?? null;
  return pickSide(tense, (today.getTime() - past.getTime()) / DAY_MS, (coming.getTime() - today.getTime()) / DAY_MS) === 'coming' ? coming : past;
}

/** Resolve a month without a year: the month we are in, or the past or the coming one, as impliedDay does. */
function impliedMonth(m: number, now: Date, tense: Tense): Date {
  const today = startOfDay(now);
  const y = now.getFullYear();
  const cands = [y - 1, y, y + 1].map((yy) => day(yy, m - 1, 1));
  const endOf = (c: Date) => day(c.getFullYear(), c.getMonth() + 1, 0);
  const current = cands.find((c) => c <= today && endOf(c) >= today);
  if (current) return current;
  const past = [...cands].reverse().find((c) => endOf(c) < today) ?? (cands[0] as Date);
  const coming = cands.find((c) => c > today) ?? (cands[2] as Date);
  return pickSide(tense, (today.getTime() - endOf(past).getTime()) / DAY_MS, (coming.getTime() - today.getTime()) / DAY_MS) === 'coming' ? coming : past;
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

interface NumericOpts { locale: string; flip?: string[]; now: Date; tenseAt: (index: number) => Tense; forMentions?: boolean }

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
    found.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'day', start: dt, last: dt, ambiguous: false, explicit: true });
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
    // an order the locale had to guess (1-2-2026) is Sieve's reading, not the person's
    found.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'day', start: dt, last: dt, ambiguous, explicit: !ambiguous });
    rest = blank(rest, m.index, m[0].length);
  }
  for (const m of rest.matchAll(/\b(\d{1,2})\/(\d{1,2})\b(?!\/\d)/g)) {
    if (notDateContext(m.index, m[0].length)) continue;
    const a = Number(m[1]), b = Number(m[2]);
    let first = df !== flip.has(m[0]);
    let ambiguous = a <= 12 && b <= 12 && a !== b;
    let [mo, d] = first ? [b, a] : [a, b];
    const resolve = (mm: number, dd: number) => (o.forMentions ? nearestDay(mm, dd, o.now) : impliedDay(mm, dd, o.now, o.tenseAt(m.index)));
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
    found.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'day', start: dt, last: dt, ambiguous, explicit: false });
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

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

/** "The end of November", "the start of the month": a part of a month, a year or this week. */
function partOf(part: string, unit: string, year: string | undefined, now: Date, tense: Tense): [Date, Date] {
  const today = startOfDay(now);
  if (unit === 'week') {
    const mon = mondayOf(today);
    return part === 'end' ? [addDays(mon, 4), addDays(mon, 6)] : part === 'middle' ? [addDays(mon, 2), addDays(mon, 3)] : [mon, addDays(mon, 1)];
  }
  if (unit === 'year') {
    const y = year ? Number(year) : today.getFullYear();
    return part === 'end' ? [day(y, 11, 1), day(y, 11, 31)] : part === 'middle' ? [day(y, 5, 1), day(y, 6, 31)] : [day(y, 0, 1), day(y, 0, 31)];
  }
  const first = unit === 'month'
    ? day(today.getFullYear(), today.getMonth(), 1)
    : year ? day(Number(year), MONTH_NAMES.indexOf(unit.slice(0, 3)), 1) : impliedMonth(MONTH_NAMES.indexOf(unit.slice(0, 3)) + 1, now, tense);
  const lastDay = day(first.getFullYear(), first.getMonth() + 1, 0);
  if (part === 'end') return [day(first.getFullYear(), first.getMonth(), 21), lastDay];
  if (part === 'middle') return [day(first.getFullYear(), first.getMonth(), 11), day(first.getFullYear(), first.getMonth(), 20)];
  return [first, day(first.getFullYear(), first.getMonth(), 10)];
}

/** Step 2: periods and holidays (own rules, before chrono). */
function periodPass(text: string, now: Date, future: boolean, tenseAt: (index: number) => Tense): { found: Found[]; rest: string } {
  const found: Found[] = [];
  let rest = text;
  const today = startOfDay(now);
  const add = (m: RegExpMatchArray, kind: Kind, start: Date, last: Date, explicit = false) => {
    const index = m.index ?? 0;
    found.push({ index, end: index + m[0].length, text: m[0], kind, start, last, ambiguous: false, explicit });
    rest = blank(rest, index, m[0].length);
  };
  const lower = () => rest.toLowerCase();
  const n = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s);

  const rules: [RegExp, (m: RegExpMatchArray) => void][] = [
    // "due before the end of November" is every day up to Nov 30, not the single day chrono reads (Nov 21, 2026). With
    // words that point ahead ("due", "upcoming") it starts today: what is still to come by then.
    [new RegExp(`\\b(?:(before|by|until|till)\\s+)?(?:the\\s+)?(end|start|beginning|middle)\\s+of\\s+(?:the\\s+|this\\s+)?(month|year|week|${MONTH_WORD})(?:\\s+(\\d{4}))?\\b`, 'gi'), (m) => {
      const lead = (m[1] ?? '').toLowerCase();
      const part = (m[2] ?? 'end').toLowerCase() === 'beginning' ? 'start' : (m[2] ?? 'end').toLowerCase();
      const [s, e] = partOf(part, (m[3] ?? 'month').toLowerCase(), m[4], now, tenseAt(m.index ?? 0));
      const explicit = !!m[4];
      if (!lead) return add(m, 'range', s, e, explicit);
      const last = part === 'end' ? e : lead === 'before' ? addDays(s, -1) : s;
      add(m, 'range', future && today <= last ? today : OPEN_START, last, explicit);
    }],
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
      const past = [...cands].reverse().find((c) => c <= today) ?? at(y);
      const coming = cands.find((c) => c >= today) ?? at(y);
      const side = pickSide(tenseAt(m.index ?? 0), (today.getTime() - past.getTime()) / DAY_MS, (coming.getTime() - today.getTime()) / DAY_MS);
      const c = side === 'coming' ? coming : past;
      add(m, 'range', addDays(c, -1), addDays(c, 1));
    }
  }
  return { found, rest };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** A weekday chrono found, without "last", "next" or "this": "sun" and "sat" are also plain words ("napping in the sun"). */
function weekdayWord(text: string): { word: string; led: boolean; turned: boolean } {
  const t = text.toLowerCase().replace(/[.,]+$/, '').trim();
  const led = /^(on|this|last|next|coming|past|previous|by|until|till|since)\b/.test(t);
  const turned = /\b(this|last|next|coming|past|previous)\b/.test(t);
  return { word: t.split(/\s+/).pop() ?? '', led, turned };
}

/**
 * A bare weekday ("on Friday") without a word that says which: both the past and the coming one, as one range from the
 * one to the other (Nov 21, 2026: "my plane takes off on Friday" was read as this week's Friday and filtered out the
 * flight on Friday, Dec 4). With words that point ahead or back, only that one.
 */
function bareWeekday(weekday: number, now: Date, tense: Tense): [Date, Date] {
  const today = startOfDay(now);
  const back = (today.getDay() - weekday + 7) % 7;
  const ahead = (weekday - today.getDay() + 7) % 7;
  const past = addDays(today, -back);
  const coming = addDays(today, ahead);
  if (tense === 'future') return [coming, coming];
  if (tense === 'past') return [past, past];
  return [past, coming];
}

/** Step 4: chrono for word months and relative forms (default English casual parser, never en.GB). */
function chronoPass(text: string, now: Date, tenseAt: (index: number) => Tense, forMentions: boolean): Found[] {
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
    const tense = PAST_LEAD.test(text.slice(Math.max(0, r.index - 8), r.index)) || /^(from|since)\b/i.test(r.text) ? 'past' : tenseAt(r.index);
    // a year only counts as written when it is in the words: chrono also marks "the end of the month" year-certain
    const yearWritten = WRITTEN_YEAR.test(r.text);
    const base = { index: r.index, end: r.index + r.text.length, text: r.text, ambiguous: false };
    const resolve = (c: chrono.ParsedComponents): Date | null => {
      const m = c.get('month') ?? 1;
      const d = c.get('day') ?? 1;
      if (c.isCertain('year')) return day(c.get('year') ?? now.getFullYear(), m - 1, d);
      if (c.isCertain('month') && c.isCertain('day')) return forMentions ? nearestDay(m, d, now) : impliedDay(m, d, now, tense);
      return startOfDay(c.date());
    };
    if (weekday && !certainDay && !certainMonth && !r.end) {
      const w = weekdayWord(r.text);
      if (!WEEKDAYS.includes(w.word) && !w.led) continue;
      if (!w.turned) {
        const [st, en] = bareWeekday(s.get('weekday') ?? 0, now, tense);
        out.push({ ...base, kind: st.getTime() === en.getTime() ? 'day' : 'range', start: st, last: en, explicit: false });
        continue;
      }
    }
    if (!certainDay && certainMonth && !r.end) {
      const m = s.get('month') ?? 1;
      const st = s.isCertain('year') ? day(s.get('year') ?? now.getFullYear(), m - 1, 1) : impliedMonth(m, now, tense);
      out.push({ ...base, kind: 'month', start: st, last: day(st.getFullYear(), st.getMonth() + 1, 0), explicit: yearWritten && s.isCertain('year') });
      continue;
    }
    const st = resolve(s);
    if (!st) continue;
    const explicit = yearWritten && s.isCertain('year') && certainDay && certainMonth && (!r.end || r.end.isCertain('year'));
    if (r.end) {
      let en = resolve(r.end) ?? st;
      if (en < st) en = day(en.getFullYear() + 1, en.getMonth(), en.getDate());
      out.push({ ...base, kind: 'range', start: st, last: en, explicit });
    } else {
      out.push({ ...base, kind: 'day', start: st, last: st, explicit });
    }
  }
  return out;
}

function asText(f: Found): string {
  if (f.kind === 'day') return iso(f.start);
  return `${f.start.getTime() > -8e15 ? iso(f.start) : ''}..${iso(f.last)}`;
}

/** Step 3: pair dates into ranges and apply since/after/before/until. */
function combine(text: string, items: Found[]): { range?: [Date, Date]; explicit: boolean; extra: Interpreted[] } {
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
    return { range: [a.start, last], explicit: a.explicit && b.explicit, extra };
  }
  const first = sorted[0];
  if (!first) return { explicit: false, extra };
  const explicit = first.explicit;
  const lead = lower.slice(Math.max(0, first.index - 7), first.index);
  const word = /\b(since|after|before|until|till)\s*$/.exec(lead)?.[1];
  if (word === 'since') return { range: [first.start, OPEN_END], explicit, extra };
  if (word === 'after') return { range: [addDays(first.last, 1), OPEN_END], explicit, extra };
  if (word === 'before') return { range: [OPEN_START, addDays(first.start, -1)], explicit, extra };
  if (word === 'until' || word === 'till') return { range: [OPEN_START, first.last], explicit, extra };
  return { range: [first.start, first.last], explicit, extra };
}

/** Dates in a question (20 section 9.3). `flip` lists numeric dates the person flipped to the other order. */
export function parseDates(text: string, now: Date, locale: string, flip?: string[]): DateHint {
  const future = FUTURE_WORDS.test(text);
  const tenseAt = (index: number): Tense => (future ? 'future' : PAST_LEAD.test(text.slice(Math.max(0, index - 8), index)) ? 'past' : 'either');
  const num = numericPass(text, { locale, flip, now, tenseAt });
  const per = periodPass(num.rest, now, future, tenseAt);
  const chr = chronoPass(per.rest, now, tenseAt, false);
  const all = [...num.found, ...per.found, ...chr];
  const interpreted: Interpreted[] = all.sort((a, b) => a.index - b.index).map((f) => ({ text: f.text, as: asText(f), ambiguous: f.ambiguous }));
  if (all.length === 0) return { interpreted: [], explicit: false };
  const { range, explicit, extra } = combine(text, all);
  const hint: DateHint = { interpreted: [...interpreted, ...extra], explicit: false };
  if (range) {
    const [s, e] = range;
    if (s.getTime() > -8e15) hint.after = iso(s);
    if (e.getTime() < 8e15) hint.before = iso(e);
    hint.explicit = explicit && (!!hint.after || !!hint.before);
  }
  return hint;
}

/** Days an item's text mentions (ingest, 20 section 12.1): numeric and word-month dates near the item's date. */
export function mentionedDays(text: string, itemDate: number, locale: string): string[] {
  const src = text.slice(0, 20_000);
  if (!src.trim()) return [];
  const ref = new Date(itemDate);
  const num = numericPass(src, { locale, now: ref, tenseAt: () => 'either', forMentions: true });
  const chr = chronoPass(num.rest, ref, () => 'either', true);
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
