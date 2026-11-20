// Reads the robustness corpus (docs/spec/70-robustness.md section 14) from tests/fixtures/robustness/.
// JSON files hold { cases: [{ id, input, expected, note }] }; test names use the case ids, so a failure names the
// fixture. Node only (Vitest's jsdom environment still has node:fs).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CorpusCase<I = unknown, E = unknown> { id: string; input: I; expected: E; note?: string }
export interface CorpusFile<I = unknown, E = unknown> { cases: CorpusCase<I, E>[]; [extra: string]: unknown }

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'tests', 'fixtures', 'robustness'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const ROBUST_DIR = join(repoRoot(), 'tests', 'fixtures', 'robustness');

/** One corpus JSON file, e.g. corpus('questions.json') or corpus('gmail/charset-utf-8.json'). */
export function corpus<I = unknown, E = unknown>(rel: string): CorpusFile<I, E> {
  return JSON.parse(readFileSync(join(ROBUST_DIR, rel), 'utf8')) as CorpusFile<I, E>;
}

/** The case with this id; throws with the file name when it is missing. */
export function corpusCase<I = unknown, E = unknown>(rel: string, id: string): CorpusCase<I, E> {
  const c = corpus<I, E>(rel).cases.find((x) => x.id === id);
  if (!c) throw new Error(`${rel} has no case "${id}"`);
  return c;
}

/** A binary corpus file as bytes; null when it is absent (a file made by hand on the demo Mac). */
export function corpusBytes(rel: string): Uint8Array | null {
  const p = join(ROBUST_DIR, rel);
  if (!existsSync(p)) return null;
  return new Uint8Array(readFileSync(p));
}

/** Whether a corpus file is present (some are made by hand on the demo Mac). */
export function corpusExists(rel: string): boolean {
  return existsSync(join(ROBUST_DIR, rel));
}
