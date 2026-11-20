import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

const CANDIDATE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
const LENGTHS: Record<string, number> = { NO: 15, BE: 16, DK: 18, FI: 18, NL: 18, AT: 20, CH: 21, DE: 22, GB: 22, IE: 22, ES: 24, SE: 24, PT: 25, FR: 27, IT: 27, PL: 28 };

/** Length check for listed countries (else 15 to 34) and mod-97 === 1. */
export function isValidIban(compact: string): boolean {
  const s = compact.toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s) || s.length < 15 || s.length > 34) return false;
  const expected = LENGTHS[s.slice(0, 2)];
  if (expected !== undefined && expected !== s.length) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let m = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) m = (m * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return m === 1;
}

export function findIbans(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const raw = m[0];
    const compact = raw.replace(/ /g, '');
    for (let len = compact.length; len >= 15; len--) {
      if (!isValidIban(compact.slice(0, len))) continue;
      let count = 0;
      let end = m.index;
      for (let k = 0; k < raw.length; k++) {
        if (raw[k] !== ' ') count++;
        if (count === len) {
          end = m.index + k + 1;
          break;
        }
      }
      out.push(vspan(m.index, end, 'iban'));
      break;
    }
  }
  return out;
}
