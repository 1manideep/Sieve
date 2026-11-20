// Known gaps found by the robustness audit (docs/review/robustness-audit.md). A gap test states the behaviour 70
// requires and is expected to fail against the module as built; when the audit's patch lands it starts passing,
// Vitest reports it, and the `gap(...)` call becomes a plain `it(...)`.
import { it } from 'vitest';

export function gap(entry: string, name: string, fn: () => unknown | Promise<unknown>): void {
  it.fails(`[gap ${entry}] ${name}`, fn);
}
