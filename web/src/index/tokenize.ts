// Tokenizer, stop words and S-stemmer for the keyword safety net and the vocabulary (20 section 8.2).

export const STOP_WORDS = new Set((
  'a an the my me i im ive id you your yours we our us they them their he she his her him it its this that these those ' +
  'is are was were be been being am do does did done doing have has had having can could should would will shall may might must ' +
  'what whats when where who whom whose why which how there here any some anything something everything thing things ' +
  'to of in on for and or at by from with about into out over under up down off as if so than then too very just also ' +
  'not no yes all each both few more most much many lot lots own same other again ever still now ' +
  'please thanks thank hi hello hey ok okay find show tell say said says get got give look looking search see ' +
  'want wants wanted need needs know let lets come came latest newest new last recent recently lately ago ' +
  'day days week weeks month months year years today yesterday email emails mail inbox message messages file files ' +
  'example com net org www http https'
).split(' '));

const STEM_EXCEPTIONS = new Set('news always perhaps series species ios gas plus bus yes this its has was is us lens means thanks'.split(' '));

/** Harman S-stemmer with exceptions (20 section 8.2). */
export function sStem(w: string): string {
  if (STEM_EXCEPTIONS.has(w)) return w;
  if (w.length > 4 && w.endsWith('ies') && !w.endsWith('eies') && !w.endsWith('aies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('es') && !w.endsWith('aes') && !w.endsWith('ees') && !w.endsWith('oes')) return w.slice(0, -1);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('us') && !w.endsWith('ss') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

const RAW_TOKEN = /[\p{L}\p{N}]+(?:[.,'\-#][\p{L}\p{N}]+)*/gu;

/** Splits text into raw tokens with the expansions of 20 section 8.2 (case kept; processTerm lowercases). */
export function tokenize(text: string): string[] {
  const norm = text.normalize('NFKC').replace(/[‘’ʼ]/g, "'");
  const out: string[] = [];
  for (const m of norm.matchAll(RAW_TOKEN)) {
    let tok = m[0];
    // grouped numbers lose commas: 1,200 -> 1200
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(tok)) tok = tok.replace(/,/g, '');
    // decimals emit the number and its integer part
    if (/^\d+\.\d+$/.test(tok)) {
      out.push(tok, tok.split('.')[0] ?? tok);
      continue;
    }
    // 's endings drop; other apostrophes are removed
    tok = tok.replace(/'s$/i, '').replace(/'/g, '');
    if (tok.includes('-') || tok.includes('#')) {
      const parts = tok.split(/[-#]/).filter(Boolean);
      out.push(parts.join(''));
      for (const p of parts) out.push(...splitLetterPunct(p));
      continue;
    }
    out.push(...splitLetterPunct(tok));
  }
  return out;
}

/** Tokens with . or , between letters split (e.g. "e.g", "hello,world"); numbers like 3.5 were handled above. */
function splitLetterPunct(tok: string): string[] {
  if (!/[.,]/.test(tok)) return [tok];
  if (/^[\d.,]+$/.test(tok)) return [tok.replace(/,/g, '')];
  return tok.split(/[.,]/).filter(Boolean);
}

/** lowercase; under 2 chars, stop words and stop-word stems give null; S-stemmer otherwise. */
export function processTerm(term: string): string | null {
  const t = term.toLowerCase();
  if (t.length < 2) return null;
  if (STOP_WORDS.has(t)) return null;
  const stem = sStem(t);
  if (STOP_WORDS.has(stem)) return null;
  return stem;
}

/** Processed terms of a text, in order (duplicates kept). */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(text)) {
    const p = processTerm(t);
    if (p) out.push(p);
  }
  return out;
}
