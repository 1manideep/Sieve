// Warm base sessions (10 section 7.4, decision A6). One base per purpose holds only Sieve's fixed system prompt,
// never personal data. Each call clones a base, prompts once, and the adapter destroys the clone, so no call can see
// another call's content (00 decision 3).
import { IMAGE_CREATE_OPTIONS, MAX_BASE_SESSIONS, TEXT_CREATE_OPTIONS } from '../config';
import { sessionKeyFor } from '../keys';
import { CAPTION_SYSTEM, LABEL_SYSTEM, SELECT_SYSTEM, VERIFY_SYSTEM, WORDS_SYSTEM } from '../prompts';
import { getNanoState } from './availability';
import { getLanguageModel, type LanguageModelSession } from './languageModel';

export interface BaseSessionSpec {
  key: string;
  system?: string;
  image: boolean;
}

interface BaseEntry {
  promise: Promise<LanguageModelSession>;
  state: { session?: LanguageModelSession; dropped: boolean };
  lastUsed: number;
}

const bases = new Map<string, BaseEntry>();
let useCounter = 0;

/** select-answer and verify-answer first (the first question finds them warm), then label, then caption (image only if available). */
export const FOREGROUND_FIRST: BaseSessionSpec[] = [
  { key: sessionKeyFor('select-answer', false, SELECT_SYSTEM), system: SELECT_SYSTEM, image: false },
  { key: sessionKeyFor('verify-answer', false, VERIFY_SYSTEM), system: VERIFY_SYSTEM, image: false },
  { key: sessionKeyFor('search-words', false, WORDS_SYSTEM), system: WORDS_SYSTEM, image: false },
  { key: sessionKeyFor('label', false, LABEL_SYSTEM), system: LABEL_SYSTEM, image: false },
  { key: sessionKeyFor('caption', true, CAPTION_SYSTEM), system: CAPTION_SYSTEM, image: true },
];

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/** Resolves with `p`, or rejects as soon as `signal` aborts. */
function raceSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function evictLeastRecentlyUsed(): void {
  let oldestKey: string | undefined;
  let oldest = Infinity;
  for (const [key, entry] of bases) {
    if (entry.lastUsed < oldest) {
      oldest = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) forget(oldestKey);
}

function forget(key: string): void {
  const entry = bases.get(key);
  if (!entry) return;
  bases.delete(key);
  entry.state.dropped = true;
  entry.state.session?.destroy();
}

function getBase(spec: BaseSessionSpec): BaseEntry {
  const existing = bases.get(spec.key);
  if (existing) {
    existing.lastUsed = ++useCounter;
    return existing;
  }
  const LM = getLanguageModel();
  if (!LM) throw new DOMException('This browser has no Prompt API.', 'NotSupportedError');
  if (bases.size >= MAX_BASE_SESSIONS) evictLeastRecentlyUsed();
  const state: BaseEntry['state'] = { dropped: false };
  const promise = LM.create({
    ...(spec.image ? IMAGE_CREATE_OPTIONS : TEXT_CREATE_OPTIONS),
    initialPrompts: spec.system ? [{ role: 'system', content: spec.system }] : [],
  }).then(
    (session) => {
      if (state.dropped) {
        session.destroy();
        throw new DOMException('The on-device session was closed.', 'InvalidStateError');
      }
      state.session = session;
      return session;
    },
    (e: unknown) => {
      if (bases.get(spec.key)?.state === state) bases.delete(spec.key);
      throw e;
    },
  );
  promise.catch(() => undefined);
  const entry: BaseEntry = { promise, state, lastUsed: ++useCounter };
  bases.set(spec.key, entry);
  return entry;
}

/** Gets or creates the base, then clones it. A failed clone (not an abort) recreates the base once. */
export async function cloneFromBase(spec: BaseSessionSpec, signal: AbortSignal): Promise<LanguageModelSession> {
  for (let attempt = 0; ; attempt += 1) {
    const entry = getBase(spec);
    let base: LanguageModelSession;
    try {
      base = await raceSignal(entry.promise, signal);
    } catch (e) {
      if (isAbort(e) || attempt > 0) throw e;
      forget(spec.key);
      continue;
    }
    try {
      return await base.clone({ signal });
    } catch (e) {
      if (isAbort(e) || attempt > 0) throw e;
      forget(spec.key);
    }
  }
}

/** Creates the missing bases one after another, only when the matching availability is 'available'. Never throws. */
export async function warmBaseSessions(specs: BaseSessionSpec[]): Promise<void> {
  for (const spec of specs) {
    const state = getNanoState();
    const ready = (spec.image ? state.image : state.text) === 'available';
    if (!ready || bases.has(spec.key)) continue;
    try {
      await getBase(spec).promise;
    } catch {
      // A refused or failed warm-up is retried on demand by the next call.
    }
  }
}

/** Destroys every base (availability left 'available', or the page is going away). */
export function dropBaseSessions(): void {
  for (const key of [...bases.keys()]) forget(key);
}

export function baseSessionCount(): number {
  return bases.size;
}
