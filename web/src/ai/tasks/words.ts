// searchWords: before the search, Gemini Nano names other words the answering item may use ("bike cage" for "bicycle storage"),
// and the search adds what they find by keyword (web/src/index/search.ts, `expand`). On-device only: the question
// never goes to the cloud for it, and without the on-device model, or past the time limit, the search runs as it is.
import type { DataClass } from '@sieve/shared';
import { WORDS_SCHEMA, WORDS_SYSTEM } from '../prompts';
import { runModel } from '../runModel';
import { promptField } from '../text';
import type { RunModelResult } from '../types';

export const WORDS_MAX = 6;
const WORD_CHARS = 40;

/** The model's reply as search words: short strings, at most WORDS_MAX, or null when it is not such a list. */
export function parseWords(v: unknown): string[] | null {
  const words = (v as { words?: unknown } | null)?.words;
  if (!Array.isArray(words)) return null;
  return words
    .filter((w): w is string => typeof w === 'string')
    .map((w) => w.replace(/\s+/g, ' ').trim())
    .filter((w) => w.length > 1 && w.length <= WORD_CHARS)
    .slice(0, WORDS_MAX);
}

export async function searchWords(question: string, data: DataClass, opts: { signal?: AbortSignal } = {}): Promise<RunModelResult<string[]>> {
  return runModel<string[]>({
    purpose: 'search-words',
    mode: 'ONLY_ON_DEVICE',
    data,
    system: WORDS_SYSTEM,
    schema: WORDS_SCHEMA,
    prompt: `Question: ${promptField(question, 600)}`,
    recordIds: [],
    signal: opts.signal,
    priority: 'foreground',
    dataChars: question.length,
    validate: parseWords,
  });
}
