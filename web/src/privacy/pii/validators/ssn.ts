import type { PiiSpan } from '@sieve/shared';
import { labelWithin, vspan } from './span';

const DASHED = /(?<!\d)(\d{3})([- ])(\d{2})\2(\d{4})(?!\d)/g;
const BARE = /(?<!\d)\d{9}(?!\d)/g;
const SSN_LABEL = /\b(ssn|social security(?: number| no\.?)?|ss#|itin)\b/i;

export function isValidSsn(area: string, group: string, serial: string): boolean {
  const a = Number(area);
  return a !== 0 && a !== 666 && !(a >= 900 && a <= 999) && group !== '00' && serial !== '0000';
}

export function findSsns(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(DASHED)) {
    if (isValidSsn(m[1]!, m[3]!, m[4]!)) out.push(vspan(m.index, m.index + m[0].length, 'ssn'));
  }
  for (const m of text.matchAll(BARE)) {
    const d = m[0];
    if (labelWithin(text, m.index, 25, SSN_LABEL) && isValidSsn(d.slice(0, 3), d.slice(3, 5), d.slice(5))) {
      out.push(vspan(m.index, m.index + 9, 'ssn'));
    }
  }
  return out;
}
