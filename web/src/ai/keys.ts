// Cache and session keys shared by hybrid.ts and device/sessions.ts (10 sections 6.2 and 7.4).
import type { Purpose } from './types';

/** 32-bit FNV-1a of the string, as 8 hex digits. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The warm base session a call clones: one per purpose, input kind and system prompt. */
export function sessionKeyFor(purpose: Purpose, image: boolean, system: string | undefined): string {
  return `${purpose}|${image ? 'img' : 'txt'}|${fnv1a(system ?? '')}`;
}
