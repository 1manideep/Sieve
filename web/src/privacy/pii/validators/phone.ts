// Phone numbers through libphonenumber-js (max metadata), loaded on first use so it stays out of the first page load.
import type { PiiSpan } from '@sieve/shared';
import type { CountryCode } from 'libphonenumber-js/max';
import { labelWithin, vspan } from './span';

type PhoneLib = typeof import('libphonenumber-js/max');

let lib: PhoneLib | undefined;
let loading: Promise<void> | undefined;
let country: CountryCode | undefined;

export function phoneLibReady(): boolean {
  return lib !== undefined;
}

export function loadPhoneLib(): Promise<void> {
  loading ??= import('libphonenumber-js/max').then((m) => {
    lib = m;
  });
  return loading;
}

/** new Intl.Locale(navigator.language).maximize().region when supported, else US; computed once. */
export function defaultPhoneCountry(): CountryCode {
  if (country) return country;
  let region: string | undefined;
  try {
    const language = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
    region = new Intl.Locale(language).maximize().region;
  } catch {
    region = undefined;
  }
  country = region && lib?.isSupportedCountry(region) ? (region as CountryCode) : 'US';
  return country;
}

const SKIP_BEFORE = /\b(order|invoice|ref|reference|confirmation|tracking|booking|ticket|case|claim|policy|member|id|no\.?|#)\s*[:#]?\s*$/i;
const PHONE_LABEL = /\b(phone|tel|call|cell|mobile|fax|text|sms|whatsapp|contact)\b/i;
const LOCAL = /(?<!\d)\d{3}[-.\s]\d{4}(?!\d)/g;

export function findPhones(text: string): PiiSpan[] {
  if (!lib) throw new Error('The phone validator is not loaded yet.');
  const out: PiiSpan[] = [];
  const found = lib.findPhoneNumbersInText(text, { defaultCountry: defaultPhoneCountry() });
  for (const r of found) {
    if (!r.number.isValid()) continue;
    if (SKIP_BEFORE.test(text.slice(Math.max(0, r.startsAt - 24), r.startsAt)) && !labelWithin(text, r.startsAt, 40, PHONE_LABEL)) continue;
    out.push(vspan(r.startsAt, r.endsAt, 'phone'));
  }
  for (const m of text.matchAll(LOCAL)) {
    if (labelWithin(text, m.index, 30, PHONE_LABEL)) out.push(vspan(m.index, m.index + m[0].length, 'phone'));
  }
  return out;
}
