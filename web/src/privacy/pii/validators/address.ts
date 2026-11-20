import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

const STREET_TYPES = '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Square|Sq|Trail|Trl)';
const STREET = new RegExp(String.raw`\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:\p{Lu}[\p{L}'’.-]*\s+){1,4}${STREET_TYPES}\.?(?:\s*,?\s*(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*[\w-]{1,6})?(?![\p{L}])`, 'gu');
const PO_BOX = /\bP\.?\s?O\.?\s+Box\s+\d{1,6}\b/gi;

export function findAddresses(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(STREET)) out.push(vspan(m.index, m.index + m[0].length, 'address'));
  for (const m of text.matchAll(PO_BOX)) out.push(vspan(m.index, m.index + m[0].length, 'address'));
  return out;
}
