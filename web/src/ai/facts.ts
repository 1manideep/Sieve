// Fact helpers (10 section 10.1): amounts, times, dates, emails, links and numbers, normalized so that
// "$1,200", "1200" and "1,200" match, and "March 3" and "3 March" match. Used by excerpts and the draft check.

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const FACT_RE = new RegExp(
  [
    String.raw`\$\s?\d(?:[\d,]*\d)?(?:\.\d+)?`,    // ends with a digit, so "$1,500," gives "$1,500"
    String.raw`\b\d{1,2}:\d{2}\s?(?:am|pm)?\b`,
    String.raw`\b(?:${MONTHS})[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:${MONTHS})[a-z]*\b`,
    String.raw`[\w.+-]+@[\w-]+\.[\w.]+`,
    String.raw`https?:\/\/\S+`,
    String.raw`\b\d[\d,.]*\d\b`,
    String.raw`\b\d{2,}\b`,
  ].join('|'),
  'gi',
);
const MONTH_DAY_RE = new RegExp(String.raw`^(${MONTHS})[a-z]*\.?\s+(\d{1,2})`, 'i');
const DAY_MONTH_RE = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS})`, 'i');

/** Raw facts in `s`, in order, after removing [...] placeholders. */
export function extractFacts(s: string): string[] {
  const text = s.replace(/\[[^\]]*\]/g, ' ');
  return [...text.matchAll(FACT_RE)].map((m) => m[0]);
}

export function normFact(f: string): string {
  const s = f.trim();
  if (/^https?:\/\//i.test(s) || s.includes('@')) return `lit:${s.toLowerCase().replace(/[.,;:!?)\]]+$/, '')}`;
  const time = /^(\d{1,2}):(\d{2})/.exec(s);
  if (time) return `time:${Number(time[1])}:${time[2]}`;
  const md = MONTH_DAY_RE.exec(s);
  if (md) return `date:${md[1].toLowerCase().slice(0, 3)}-${Number(md[2])}`;
  const dm = DAY_MONTH_RE.exec(s);
  if (dm) return `date:${dm[2].toLowerCase().slice(0, 3)}-${Number(dm[1])}`;
  const digits = s.replace(/[^\d.]/g, '').replace(/\.0+$/, '').replace(/\.$/, '');
  return `num:${digits}`;
}

export function normalizedFacts(s: string): Set<string> {
  return new Set(extractFacts(s).map(normFact));
}

/** The raw facts of `text` whose normalized form is in none of `sources`, in order, deduplicated. */
export function findUnsupportedFacts(text: string, sources: string[]): string[] {
  const known = new Set<string>();
  for (const source of sources) for (const f of normalizedFacts(source)) known.add(f);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of extractFacts(text)) {
    const n = normFact(raw);
    if (known.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(raw.trim());
  }
  return out;
}
