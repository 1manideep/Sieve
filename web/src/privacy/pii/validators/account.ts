import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

const ACCOUNT = /\b(account|acct|a\/c|checking|savings|routing|aba|rtn|sort code|bsb)\b(?:\s+(?:number|no\.?|#|num))?\s*[:#]?\s*(\d[\d -]{4,20}\d)/gi;

/** ABA routing checksum and the Federal Reserve prefix ranges. */
export function isValidAba(d: string): boolean {
  if (!/^\d{9}$/.test(d)) return false;
  const x = [...d].map(Number) as number[];
  if ((3 * (x[0]! + x[3]! + x[6]!) + 7 * (x[1]! + x[4]! + x[7]!) + (x[2]! + x[5]! + x[8]!)) % 10 !== 0) return false;
  const first = Number(d.slice(0, 2));
  return first <= 12 || (first >= 21 && first <= 32) || (first >= 61 && first <= 72) || first === 80;
}

export function findAccounts(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(ACCOUNT)) {
    const label = m[1]!.toLowerCase();
    const digitsText = m[2]!;
    const digits = digitsText.replace(/\D/g, '');
    const start = m.index + m[0].length - digitsText.length;
    const between = text.slice(m.index + m[1]!.length, start).toLowerCase();
    if (/ending|ends in|last 4|last four/.test(between)) continue;
    if (label === 'routing' || label === 'aba' || label === 'rtn') {
      if (!isValidAba(digits)) continue;
    } else if (digits.length < 6 || digits.length > 17) {
      continue;
    }
    out.push(vspan(start, start + digitsText.length, 'account'));
  }
  return out;
}
