import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

export function findIps(text: string): PiiSpan[] {
  return [...text.matchAll(IPV4)].map((m) => vspan(m.index, m.index + m[0].length, 'other'));
}
