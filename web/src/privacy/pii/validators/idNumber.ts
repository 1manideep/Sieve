// The ID-number rule (11 section 5.6 step 1, Nov 21): a span of type 'other' (an ID number, from the browser model or
// Gemini Nano) is kept only when it reads as an ID. A brand or product name that merely holds a digit or two
// ("Z1llow", "1Password", "3M", "web3") is not one. IP addresses come from a validator and are not affected.

/** Order and reference numbers with a short prefix: "#482", "No. 12", "RX-66", "INV-12". */
const ID_SHAPE = /^(?:#\s?\d+|[Nn][OoRr]\.?\s?\d+|[A-Z]{1,4}[-#/]\d+[A-Z0-9-]*)$/;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

/** Lowercase letters and digits, and the same with look-alike digits read as letters ("z1llow" gives "zillow"). */
function forms(value: string): string[] {
  const plain = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const read = plain.replace(/[0134578]/g, (d) => LEET[d] ?? d);
  return read === plain ? [plain] : [plain, read, plain.replace(/1/g, 'l')];
}

/**
 * True when the value reads as an ID number: 4 or more digits, or a known ID shape, and not a word that names a sender
 * in the index (`senders`: lowercase sender words, such as "1password" or "zillow").
 */
export function looksLikeIdNumber(value: string, senders?: ReadonlySet<string>): boolean {
  const v = value.trim();
  if (!v) return false;
  if (senders && senders.size > 0 && forms(v).some((f) => senders.has(f))) return false;
  if ((v.match(/\d/g) ?? []).length >= 4) return true;
  return ID_SHAPE.test(v);
}
