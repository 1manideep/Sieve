// Typo correction against the index vocabulary and the word list (20 section 9.2).
import { TYPO_MIN_LEN } from './config';
import { dictionaryCandidates, isDictionaryLoaded, isEnglishWord, wordLevel } from './dictionary';
import { STOP_WORDS, processTerm } from './tokenize';
import type { Vocab } from './vocab';

/** Words a question uses for hints; never "corrected" even when the word list lacks them (20 section 9.4). */
const HINT_WORDS = new Set((
  'email emails mail inbox photo photos picture pictures pic pics image images selfie screenshot ' +
  'file files document documents doc docs pdf note notes chat landlord doctor dentist bank boss manager mom dad ' +
  'pharmacy airline upcoming next will coming due leave leaves leaving depart departs departure arrive arrives ' +
  'arriving scheduled tomorrow today yesterday christmas halloween valentine thanksgiving'
).split(' '));

/** Optimal string alignment distance, stopping early once it exceeds `max`. */
export function osaDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (prev2[j - 2] ?? 0) + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m] ?? 0;
}

interface Best { word: string; dist: number; inVocab: boolean; freq: number; level: number; swap: boolean; subseq: boolean; common: boolean }

function sameLetters(a: string, b: string): boolean {
  return a.length === b.length && [...a].sort().join('') === [...b].sort().join('');
}

/** The typed letters appear in order inside the candidate: only letters were dropped ("maried" in "married"). */
function isSubsequence(typed: string, word: string): boolean {
  let i = 0;
  for (const ch of word) if (ch === typed[i]) i++;
  return i === typed.length;
}

/**
 * 20 section 9.2 step 4 (distance, then index vocabulary first, then frequency or level, then alphabetical), with
 * tie-breaks added before frequency and level, measured on the D7 typo set: a swap of two letters ("waht"), then a
 * dropped letter ("maried", "wher", "hav"), then the most common words win among equal distances. Alphabetical order
 * alone turned "waht" into "baht", "maried" into "marked" and "wher" into "when".
 */
function better(a: Best, b: Best | null): boolean {
  if (!b) return true;
  if (a.dist !== b.dist) return a.dist < b.dist;
  if (a.inVocab !== b.inVocab) return a.inVocab;
  if (a.swap !== b.swap) return a.swap;
  if (a.subseq !== b.subseq) return a.subseq;
  if (a.common !== b.common) return a.common;
  if (a.inVocab && a.freq !== b.freq) return a.freq > b.freq;
  if (!a.inVocab && a.level !== b.level) return a.level < b.level;
  return a.word < b.word;
}

export interface Correction { from: string; to: string; start: number }

/** Returns the corrected question and the replacements made. Emoji and ids are never touched. */
export function correctQuery(normalized: string, vocab: Vocab | null): { corrected: string; fixes: Correction[] } {
  if (!isDictionaryLoaded()) return { corrected: normalized, fixes: [] };
  const fixes: Correction[] = [];
  let out = '';
  let last = 0;
  let firstWord = true;
  for (const m of normalized.matchAll(/[A-Za-z][A-Za-z']*/g)) {
    const token = m[0];
    const start = m.index;
    const end = start + token.length;
    const isFirst = firstWord;
    firstWord = false;
    const before = normalized[start - 1] ?? '';
    const after = normalized[end] ?? '';
    // ids, addresses and file names: digits or @ # / . - joined to the token
    if (/[\d@#/._-]/.test(before) || /[\d@#/_-]/.test(after) || (after === '.' && /[A-Za-z\d]/.test(normalized[end + 1] ?? ''))) continue;
    const bare = token.replace(/'/g, '');
    const lower = bare.toLowerCase();
    if (bare.length < TYPO_MIN_LEN) continue;
    if (!isFirst && /^[A-Z]/.test(token)) continue;            // a likely name
    if (isEnglishWord(lower) || STOP_WORDS.has(lower) || HINT_WORDS.has(lower)) continue;
    const pt = processTerm(lower);
    if (pt && vocab?.has(pt)) continue;
    if (vocab && vocab.wordFrequency(lower) > 0) continue;

    const maxDist = lower.length <= 4 ? 1 : 2;
    let best: Best | null = null;
    const make = (w: string, dist: number, inVocab: boolean): Best => ({
      word: w, dist, inVocab, freq: vocab?.wordFrequency(w) ?? 0, level: wordLevel(w) ?? 50,
      swap: dist === 1 && sameLetters(lower, w), subseq: isSubsequence(lower, w), common: STOP_WORDS.has(w),
    });
    if (vocab) {
      for (const [w] of vocab.wordEntries()) {
        if (w.length < TYPO_MIN_LEN || Math.abs(w.length - lower.length) > maxDist) continue;
        const dist = osaDistance(lower, w, maxDist);
        if (dist > maxDist) continue;
        const cand = make(w, dist, true);
        if (better(cand, best)) best = cand;
      }
    }
    for (const w of dictionaryCandidates(lower.length, maxDist)) {
      const dist = osaDistance(lower, w, maxDist);
      if (dist > maxDist) continue;
      // two edits away and only in the word list: common words only ("hotdog" must not become "hoodoo")
      if (dist === 2 && (vocab?.wordFrequency(w) ?? 0) === 0 && wordLevel(w) !== 35) continue;
      // stop words count as everyone's vocabulary, so "abot" is "about", not the index's "bot"
      const cand = make(w, dist, (vocab?.wordFrequency(w) ?? 0) > 0 || STOP_WORDS.has(w));
      if (better(cand, best)) best = cand;
    }
    if (!best) continue;
    out += normalized.slice(last, start) + best.word;
    last = end;
    fixes.push({ from: token, to: best.word, start });
  }
  out += normalized.slice(last);
  return { corrected: out, fixes };
}
