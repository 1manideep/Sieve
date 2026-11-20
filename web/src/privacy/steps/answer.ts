// The answer step (11 section 10.3, capped at 300 characters by 00 decision D5).
import type { PiiType } from '@sieve/shared';
import { ANSWER_MAX_CHARS } from '../constants';
import { cutAtSentence } from '../text';

/** Trims, removes Markdown, collapses whitespace, caps at ANSWER_MAX_CHARS at a sentence end (grapheme-safe). */
export function cleanAnswer(raw: string): string {
  let s = raw.trim();
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                   // Markdown images never become fetches
  s = s.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');              // Markdown links: their text only
  s = s.replace(/\*\*|__|`/g, '');
  s = s.split('\n').map((line) => line.replace(/^\s*(?:#{1,6}\s+|-\s+)/, '')).join('\n');
  s = s.replace(/\s+/g, ' ').trim();
  return cutAtSentence(s, ANSWER_MAX_CHARS);
}

const PHONE_Q = /\b(phone|telephone|mobile|cell|number to call|contact number|call (?:him|her|them))\b/i;
const EMAIL_Q = /\b(e-?mail address|email of|email for|(?:his|her|their) email|contact email)\b/i;
const ADDRESS_Q = /\b(address|where (?:does|do|did|is|are) .{1,40} (?:live|located|based)|street)\b/i;
const NAME_Q = /\b(who|whom|whose|name)\b/i;

/** Types the question explicitly asks for; kept in the answer step only. Cards, accounts, SSNs and dates of birth never are. */
export function answerKeepTypes(question: string): PiiType[] {
  const out: PiiType[] = [];
  if (PHONE_Q.test(question)) out.push('phone');
  if (EMAIL_Q.test(question)) out.push('email');
  if (ADDRESS_Q.test(question.replace(/\b(?:e-?mail|ip|web)\s+address(?:es)?\b/gi, ' '))) out.push('address');
  if (NAME_Q.test(question)) out.push('name');
  return out;
}
