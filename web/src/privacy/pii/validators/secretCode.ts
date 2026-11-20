// One-time codes and sign-in links (11 section 5.2, type 'secret-code'). Never shared: an item that holds one is
// treated like a `never` category before any model reads it (10 section 12.3 step 5), and share-time redaction
// removes any such code from outgoing text as a second line of defence (11 section 10.2).
import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

/** Words that make a nearby number a secret: verification, one-time, OTP, passcode, 2FA, sign-in, log in, confirm. */
const TRIGGER =
  /\b(?:verification|verify|verifying|one[- ]?time|otp|passcode|pass code|2fa|two[- ](?:factor|step)|2[- ]step|security code|sign[- ]?in|log[- ]?in|login|authenticat\w*|auth code|access code|confirm(?:ation)? code|confirm your|your code|the code|this code|code is|code:|codes?\s+(?:below|above))/gi;
/** A code value: 4 to 8 digits (also "123 456" and "123-456"), or 4 to 8 capitals and digits mixed ("G-482913", "K7Q2LM"). */
const VALUE = /(?<![\w$#.,/-])(?:[A-Z]{1,3}-\d{4,8}|\d{3}[ -]\d{3}|\d{4,8}|(?=[A-Z0-9]{4,8}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,8})(?![\w%]|[.,]\d|:\d)/g;
/** Not a secret: "account ending 4417", "order #88231", a booking reference, a zip or promo code, a price. */
const NOT_SECRET_BEFORE =
  /\b(?:ending(?: in)?|ends in|last (?:4|four)|account|acct|order|invoice|ref|reference|booking|reservation|confirmation number|ticket|flight|seat|room|unit|apt|suite|zip|postal|post|area|country|dial|promo|promotional|discount|coupon|voucher|referral|offer|gift|product|item|style|sku|error|status|tax|tracking|phone|tel|fax|call|extension|ext|pin code|year|since|from|until|by|on|in)\s*(?:code|number|no\.?|#)?\s*[:#]?\s*$/i;
const WINDOW_BEFORE = 60;
const WINDOW_AFTER = 40;

/** Password-reset and magic sign-in links: reset, verify, login, magic, token or otp in the path or query. */
const SIGN_IN_URL = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const SIGN_IN_PART = /(?<![a-z])(?:reset|verif\w*|log-?in|sign-?in|magic|token|otp|passwordless|one-?time|auth|oauth\w*)(?![a-z])/i;
const NOT_SIGN_IN = /(?:unsubscribe|opt-?out|preferences|email-settings|notification-settings|manage-?subscription|view-?in-?browser|webview)/i;

function sentenceAround(text: string, start: number, end: number): { from: number; to: number } {
  let from = start;
  while (from > 0 && !/[.!?\n]/.test(text[from - 1]!)) from -= 1;
  let to = end;
  while (to < text.length && !/[!?\n]/.test(text[to]!) && !(text[to] === '.' && !/\d/.test(text[to + 1] ?? ''))) to += 1;
  return { from, to };
}

function linkSpans(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(SIGN_IN_URL)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    let rest: string;
    try {
      const u = new URL(url);
      rest = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      rest = url.replace(/^https?:\/\/[^/?#]+/i, '');
    }
    if (!SIGN_IN_PART.test(rest) || NOT_SIGN_IN.test(rest)) continue;
    out.push(vspan(m.index, m.index + url.length, 'secret-code'));
  }
  return out;
}

function codeSpans(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  const triggers = [...text.matchAll(TRIGGER)].map((t) => ({ start: t.index, end: t.index + t[0].length }));
  if (triggers.length === 0) return out;
  for (const m of text.matchAll(VALUE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (/^(?:19|20)\d{2}$/.test(m[0])) continue;                                       // a year
    if (NOT_SECRET_BEFORE.test(text.slice(Math.max(0, start - 30), start))) continue;
    const s = sentenceAround(text, start, end);
    const near = triggers.some(
      (t) => t.start >= s.from && t.end <= s.to && ((t.end <= start && start - t.end <= WINDOW_BEFORE) || (t.start >= end && t.start - end <= WINDOW_AFTER)),
    );
    if (near) out.push(vspan(start, end, 'secret-code'));
  }
  return out;
}

/** Every one-time code and sign-in link in the text, as 'secret-code' spans. */
export function findSecretCodes(text: string): PiiSpan[] {
  return [...linkSpans(text), ...codeSpans(text)].sort((a, b) => a.start - b.start);
}

/** True when the item (title and text, or the preview) holds a one-time code or a sign-in link. */
export function holdsSecretCode(record: { title?: string; text?: string; preview?: string; caption?: string }): boolean {
  const body = record.text ?? record.preview ?? record.caption ?? '';
  return findSecretCodes(`${record.title ?? ''}\n${body}`).length > 0;
}
