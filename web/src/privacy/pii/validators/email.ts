import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

const EMAIL = /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
const OBFUSCATED = /\b[A-Za-z0-9._%+-]+\s*[[(]\s*at\s*[\])]\s*[A-Za-z0-9-]+(?:\s*[[(]\s*dot\s*[\])]\s*[A-Za-z0-9-]+)+/gi;

export function findEmails(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(EMAIL)) out.push(vspan(m.index, m.index + m[0].length, 'email'));
  for (const m of text.matchAll(OBFUSCATED)) out.push(vspan(m.index, m.index + m[0].length, 'email'));
  return out;
}
