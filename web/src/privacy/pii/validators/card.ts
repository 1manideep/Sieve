import type { PiiSpan } from '@sieve/shared';
import { labelWithin, vspan } from './span';

const CANDIDATE = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g;
const CARD_LABEL = /\b(card|visa|mastercard|amex|american express|discover|credit|debit|cc)\b/i;

export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let x = digits.charCodeAt(i) - 48;
    if (alt) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Brand prefix ranges and lengths (11 section 5.2 card brand table). */
export function brandMatches(d: string): boolean {
  const n = d.length;
  const p = (k: number) => Number(d.slice(0, k));
  if (d[0] === '4' && (n === 13 || n === 16 || n === 19)) return true;                       // Visa
  if (n === 16 && ((p(2) >= 51 && p(2) <= 55) || (p(4) >= 2221 && p(4) <= 2720))) return true; // Mastercard
  if (n === 15 && (p(2) === 34 || p(2) === 37)) return true;                                  // Amex
  if (n >= 16 && n <= 19 && (p(4) === 6011 || (p(3) >= 644 && p(3) <= 649) || p(2) === 65)) return true;   // Discover
  if (n >= 16 && n <= 19 && p(4) >= 3528 && p(4) <= 3589) return true;                         // JCB
  if (n >= 14 && n <= 19 && ((p(3) >= 300 && p(3) <= 305) || p(2) === 36 || p(2) === 38 || p(2) === 39)) return true;  // Diners
  if (n >= 16 && n <= 19 && p(2) === 62) return true;                                         // UnionPay
  return false;
}

export function findCards(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length < 13 || d.length > 19 || /^(\d)\1*$/.test(d) || !luhn(d)) continue;
    if (brandMatches(d) || labelWithin(text, m.index, 30, CARD_LABEL)) out.push(vspan(m.index, m.index + m[0].length, 'card'));
  }
  return out;
}
