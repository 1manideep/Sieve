// Mock of web/src/privacy for pipeline tests: vi.mock('@/privacy', () => import('./mocks/privacy')).
// The default buildStepOption returns the part for its step as the text (10 section 15).
import { vi } from 'vitest';
import type { DataClass, IndexRecord, LadderStep, StepOption, Warning } from '@sieve/shared';

type Parts = { answer?: string; excerpt?: string; full?: string };

export function defaultBuild(step: LadderStep, parts: Parts, _record: IndexRecord, _data: DataClass, _opts?: unknown): Promise<StepOption> {
  const text = parts[step] ?? '';
  return Promise.resolve({ step, text, chars: text.length, redactions: 0, available: !!parts[step] });
}

export const buildStepOption = vi.fn(defaultBuild);
export const checkInjection = vi.fn();
export const detectPii = vi.fn();
export const sanitizeIncoming = vi.fn();
export const redact = vi.fn();
export const privacyWarnings = vi.fn((_r: IndexRecord, _o: readonly StepOption[]): Warning[] => []);
export const verifyOutgoing = vi.fn();

export function resetPrivacyMock(): void {
  buildStepOption.mockReset().mockImplementation(defaultBuild);
  checkInjection.mockReset();
  detectPii.mockReset();
  privacyWarnings.mockReset().mockImplementation(() => []);
  verifyOutgoing.mockReset();
}
