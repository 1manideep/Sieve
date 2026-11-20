// locateEntities() (11 section 5.6): finds known personal details in new text.
import type { KnownEntity, PiiSpan } from '@sieve/shared';
import { escapeRegExp } from '../text';

const DIGIT_TYPES = new Set(['phone', 'card', 'iban', 'account', 'ssn']);

function entityPattern(e: KnownEntity): { re: RegExp; upperFirst: boolean } | null {
  const text = e.text.trim();
  if (!text) return null;
  if (e.type === 'name' || e.type === 'address' || e.type === 'other') {
    const body = escapeRegExp(text).replace(/\s+/g, '\\s+');
    return { re: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu'), upperFirst: e.type === 'name' };
  }
  if (e.type === 'email') return { re: new RegExp(escapeRegExp(text), 'gi'), upperFirst: false };
  if (DIGIT_TYPES.has(e.type)) {
    let chars = e.type === 'iban' ? text.toUpperCase().replace(/[^A-Z0-9]/g, '') : text.replace(/\D/g, '');
    if (e.type === 'phone') chars = chars.slice(-10);
    if (chars.length < 4) return null;
    // up to two separators between characters, so "(312) 555-0142" is found from "3125550142"
    const body = [...chars].map(escapeRegExp).join('[\\s.\\-()]{0,2}');
    return { re: new RegExp(`(?<![\\dA-Za-z])${body}(?![\\dA-Za-z])`, 'gi'), upperFirst: false };
  }
  return { re: new RegExp(escapeRegExp(text), 'g'), upperFirst: false };
}

export function locateEntities(text: string, entities: readonly KnownEntity[]): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const e of entities) {
    const p = entityPattern(e);
    if (!p) continue;
    for (const m of text.matchAll(p.re)) {
      if (p.upperFirst) {
        const c = m[0][0];
        if (c === undefined || c === c.toLowerCase()) continue;
      }
      // a phone written as "(312) 555-0142" starts at its opening parenthesis
      const start = e.type === 'phone' && text[m.index - 1] === '(' && /^\d{3}\)/.test(m[0]) ? m.index - 1 : m.index;
      const span: PiiSpan = { start, end: m.index + m[0].length, type: e.type, by: e.by };
      if (e.score !== undefined) span.score = e.score;
      out.push(span);
    }
  }
  return out;
}
