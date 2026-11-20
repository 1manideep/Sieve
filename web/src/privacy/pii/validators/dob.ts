import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

const MONTHS = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const ORD = '(?:st|nd|rd|th)?';
const WITH_YEAR = [
  String.raw`\d{4}-\d{2}-\d{2}`,
  String.raw`\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})`,
  String.raw`${MONTHS}\.?\s+\d{1,2}${ORD},?\s+\d{4}`,
  String.raw`\d{1,2}${ORD}\s+${MONTHS}\.?,?\s+\d{4}`,
].join('|');
const WITHOUT_YEAR = [
  String.raw`\d{1,2}[\/.\-]\d{1,2}`,
  String.raw`${MONTHS}\.?\s+\d{1,2}${ORD}`,
  String.raw`\d{1,2}${ORD}\s+${MONTHS}`,
].join('|');
const LABEL = String.raw`\b(DOB|D\.O\.B\.?|date of birth|birth ?date|born(?: on)?)(?![\p{L}])\s*[:\-]?\s*`;
const DOB = new RegExp(`${LABEL}(${WITH_YEAR}|${WITHOUT_YEAR})(?![\\d\\p{L}])`, 'giu');

export function findDobs(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(DOB)) {
    const label = m[1]!.toLowerCase().replace(/\./g, '');
    const date = m[2]!;
    const hasYear = new RegExp(`^(?:${WITH_YEAR})$`, 'i').test(date);
    if (!hasYear && label !== 'dob' && label !== 'date of birth') continue;   // the year is required except after DOB and date of birth
    const start = m.index + m[0].length - date.length;
    out.push(vspan(start, start + date.length, 'dob'));
  }
  return out;
}
