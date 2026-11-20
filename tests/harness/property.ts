// A small seeded property-test runner (70 section 15.7). fast-check is the spec's choice but is not yet a dev
// dependency of web; this runner keeps the same shape (a generator, N runs, the failing input in the message) with a
// fixed seed, so a failure reproduces exactly. Swap to fast-check by replacing `forAll` when it is added.

export type Rand = () => number;

/** mulberry32: small, fast, deterministic. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function int(r: Rand, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}

export function pick<T>(r: Rand, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)] as T;
}

/** A string of `n` pieces drawn from `alphabet` (each piece may be several code units, e.g. a grapheme). */
export function stringOf(r: Rand, alphabet: readonly string[], maxPieces: number): string {
  const n = int(r, 0, maxPieces);
  let s = '';
  for (let i = 0; i < n; i++) s += pick(r, alphabet);
  return s;
}

export function bytesOf(r: Rand, maxLen: number): Uint8Array {
  const n = int(r, 0, maxLen);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = int(r, 0, 255);
  return out;
}

/** Tricky pieces for text properties: ASCII, HTML, entities, invisible, bidi, tags, emoji, combining marks. */
export const TRICKY_PIECES: readonly string[] = [
  'a', 'Z', '7', ' ', '\t', '\n', '<', '>', '&', ';', '#', '<b>', '</b>', '<p>', '<script>', '</script>', '&amp;', '&lt;', '&gt;',
  '&#39;', '&#x1F382;', '&nbsp;', '&lt;b&gt;', '\u200B', '\u200D', '\uFEFF', '\u00AD', '\u202E', '\u2066', '\u0007', '\uD800',
  '\uDC00', '\uDB40\uDC41', '\uDB40\uDC7F', '\uFE0F', '\u20E3', '\u0301', 'e', 'é', '🎂', '👍🏽',
  '🇮🇳', '👨\u200D👩\u200D👧', '1\uFE0F\u20E3', '\u00A0', '\u3000', 'а', 'deposit',
];

/** Runs `prop` on `runs` generated inputs; throws with the seed, the run number and the input on the first failure. */
export function forAll<T>(gen: (r: Rand) => T, prop: (value: T) => void, opts: { runs?: number; seed?: number } = {}): void {
  const runs = opts.runs ?? 1000;
  const seed = opts.seed ?? 70;
  const r = seeded(seed);
  for (let i = 0; i < runs; i++) {
    const value = gen(r);
    try {
      prop(value);
    } catch (error) {
      const shown = typeof value === 'string' ? JSON.stringify(value) : value instanceof Uint8Array ? `bytes[${Array.from(value).join(',')}]` : JSON.stringify(value);
      throw new Error(`property failed on run ${i + 1} (seed ${seed}) for ${shown}: ${(error as Error).message}`, { cause: error });
    }
  }
}
