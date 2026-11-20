// Reads a golden file from __tests__/golden, whether Vitest runs from the repo root or from web/.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function golden(name: string): string {
  const candidates = [join(process.cwd(), 'web/src/ai/__tests__/golden', name), join(process.cwd(), 'src/ai/__tests__/golden', name)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`Golden file ${name} not found`);
  return readFileSync(path, 'utf8').replace(/\n$/, '');
}
