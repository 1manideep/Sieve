import type { PiiSpan, PiiType } from '@sieve/shared';

export function vspan(start: number, end: number, type: PiiType): PiiSpan {
  return { start, end, type, by: 'validator', score: 1 };
}

/** True when the label regex matches in the `n` characters before `at`. */
export function labelWithin(text: string, at: number, n: number, label: RegExp): boolean {
  return label.test(text.slice(Math.max(0, at - n), at));
}
