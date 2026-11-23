// The English word list for typo correction (20 section 9.2). SCOWL sizes up to 50, American spelling,
// built by tools/build-dictionary.mjs into dict/en-words.tsv (licence: dict/Copyright). Fetched once from
// Sieve's own origin; until it is loaded, parseQuestion makes no corrections.
import dictUrl from './dict/en-words.tsv?url';

type Level = 35 | 50;

let words: Map<string, Level> | null = null;
let byLength: string[][] = [];
let loading: Promise<void> | null = null;

/** Parse `word<TAB>35|50` lines. Exported for tests and the dev seed page, which read the file directly. */
export function loadDictionaryText(tsv: string): void {
  const map = new Map<string, Level>();
  const buckets: string[][] = [];
  for (const line of tsv.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const w = line.slice(0, tab);
    const level: Level = line.slice(tab + 1).trim() === '50' ? 50 : 35;
    map.set(w, level);
    (buckets[w.length] ??= []).push(w);
  }
  words = map;
  byLength = buckets;
}

/** Fetch and parse the list, once per tab (dictionaryReady calls it before a question is read). */
export function preloadDictionary(): Promise<void> {
  if (words) return Promise.resolve();
  loading ??= (async () => {
    try {
      const res = await fetch(dictUrl);
      if (!res.ok) throw new Error(`word list ${res.status}`);
      loadDictionaryText(await res.text());
    } catch (e) {
      loading = null;
      console.warn('word list not loaded; typo correction is off', String(e).slice(0, 80));
    }
  })();
  return loading;
}

export function isDictionaryLoaded(): boolean {
  return words !== null;
}

/**
 * For one question: resolves when the list is loaded, or after `capMs` without it (the fetch goes on, so the next
 * question has it). Until Nov 22, 2026 nothing in the app called preloadDictionary: the running app corrected no typo
 * and knew no sender or company word, while every test and the search eval loaded the list themselves.
 */
export function dictionaryReady(capMs = 4000): Promise<void> {
  if (words) return Promise.resolve();
  return Promise.race([preloadDictionary(), new Promise<void>((resolve) => setTimeout(resolve, capMs))]);
}

export function isEnglishWord(w: string): boolean {
  return words?.has(w.toLowerCase().replace(/'/g, '')) ?? false;
}

export function wordLevel(w: string): Level | undefined {
  return words?.get(w);
}

/** Words whose length is within `maxDist` of `len` (the only ones an edit distance can reach). */
export function dictionaryCandidates(len: number, maxDist: number): string[] {
  const out: string[] = [];
  for (let l = Math.max(1, len - maxDist); l <= len + maxDist; l++) for (const w of byLength[l] ?? []) out.push(w);
  return out;
}

/** Tests: forget the loaded list. */
export function resetDictionary(): void {
  words = null;
  byLength = [];
  loading = null;
}
