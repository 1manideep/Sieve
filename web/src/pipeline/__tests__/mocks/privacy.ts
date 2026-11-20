// Mock of web/src/privacy for pipeline tests: vi.mock('@/privacy', () => import('./mocks/privacy')).
// The default buildStepOption returns the part for its step as the text (10 section 15).
import { vi } from 'vitest';
import type { DataClass, IndexRecord, KnownEntity, LadderStep, StepOption, TraceStep, Warning } from '@sieve/shared';

type Parts = { answer?: string; excerpt?: string; full?: string };

export function defaultBuild(step: LadderStep, parts: Parts, _record: IndexRecord, _data: DataClass, _opts?: unknown): Promise<StepOption> {
  const text = parts[step] ?? '';
  return Promise.resolve({ step, text, chars: text.length, redactions: 0, available: !!parts[step] });
}

export const buildStepOption = vi.fn(defaultBuild);

/** The share-time Nano check (11 section 10.7); by default nothing would run and nothing is found. */
export interface OutgoingCheckLike {
  entities: KnownEntity[]; quotes: string[]; trace: TraceStep[]; nanoPii: boolean; ran: number; shareChecks?: unknown[];
}
export function defaultCheck(): Promise<OutgoingCheckLike> {
  return Promise.resolve({ entities: [], quotes: [], trace: [], nanoPii: false, ran: 0 });
}
export const checkOutgoing = vi.fn(
  (_r: IndexRecord, _d: 'own' | 'sample', _o: readonly StepOption[], _p: unknown, _opts?: unknown): Promise<OutgoingCheckLike> => defaultCheck(),
);
export const checkInjection = vi.fn();
export const detectPii = vi.fn();
export const sanitizeIncoming = vi.fn();
export const redact = vi.fn();
export const privacyWarnings = vi.fn((_r: IndexRecord, _o: readonly StepOption[], _s?: { nanoPii?: boolean }): Warning[] => []);
export const verifyOutgoing = vi.fn();

export function resetPrivacyMock(): void {
  buildStepOption.mockReset().mockImplementation(defaultBuild);
  checkOutgoing.mockReset().mockImplementation(defaultCheck);
  checkInjection.mockReset();
  detectPii.mockReset();
  privacyWarnings.mockReset().mockImplementation(() => []);
  verifyOutgoing.mockReset();
}
