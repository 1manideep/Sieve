// The ID-number rule (11 section 5.6 step 1, Nov 21): a span of type 'other' (an ID number, from the browser model or
// Gemini Nano) is kept only when it reads as an ID. A brand or product name that merely holds a digit or two
// ("N3stra", "1Password", "3M", "web3") is not one. IP addresses come from a validator and are not affected.

/** Order and reference numbers with a short prefix: "#482", "No. 12", "RX-66", "INV-12". */
const ID_SHAPE = /^(?:#\s?\d+|[Nn][OoRr]\.?\s?\d+|[A-Z]{1,4}[-#/]\d+[A-Z0-9-]*)$/;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

/** Lowercase letters and digits, and the same with look-alike digits read as letters ("n3stra" gives "nestra"). */
function forms(value: string): string[] {
  const plain = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const read = plain.replace(/[0134578]/g, (d) => LEET[d] ?? d);
  return read === plain ? [plain] : [plain, read, plain.replace(/1/g, 'l')];
}

/**
 * True when the value reads as an ID number: 4 or more digits, or a known ID shape, and not a word that names a sender
 * in the index (`senders`: lowercase sender words, such as "1password" or "nestra").
 */
export function looksLikeIdNumber(value: string, senders?: ReadonlySet<string>): boolean {
  const v = value.trim();
  if (!v) return false;
  if (senders && senders.size > 0 && forms(v).some((f) => senders.has(f))) return false;
  const words = v.split(/\s+/);
  if (words.length > ID_MAX_WORDS) return false;
  if (idDigits(words) >= 4) return true;
  return ID_SHAPE.test(v);
}

/** An ID is a number with a short label at most, never a sentence ("Your balance is under $40.00 USD today"). */
const ID_MAX_WORDS = 5;
const CURRENCY_SIGN = /[$\u20AC\u00A3\u20B9\u00A5]/;
const CURRENCY_CODE = /^(?:usd|eur|gbp|inr|cad|aud|rs)\.?$/i;

/** The digits that could belong to an ID: the digits of an amount of money ("$40.00", "2,480.00 INR") do not count. */
function idDigits(words: readonly string[]): number {
  let n = 0;
  words.forEach((w, i) => {
    const money = CURRENCY_SIGN.test(w) || /^\d[\d,]*\.\d{2}\D*$/.test(w) || CURRENCY_CODE.test(words[i + 1] ?? '') || CURRENCY_CODE.test(words[i - 1] ?? '');
    if (!money) n += (w.match(/\d/g) ?? []).length;
  });
  return n;
}
