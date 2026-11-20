// What normalizeQuestion removed, as the person sees it (R-IN-03, R-IN-04): the in-app note under the question, the
// relay card warnings (kind injection) and the trace step. Pure; quotes only the hidden tag text, cut at 120 units.
import type { TraceStep, Warning } from '@sieve/shared';
import { QUESTION_COPY } from './copy';
import { truncateGraphemes, type QuestionCheck } from './question';

export const HIDDEN_QUOTE_MAX_UNITS = 120;

type Removed = QuestionCheck['removed'];

/** The in-app note under the question, or null when nothing invisible was removed. */
export function questionNote(removed: Removed): string | null {
  return removed.invisible > 0 || removed.bidi > 0 || removed.tagText.length > 0 ? QUESTION_COPY.hiddenRemoved : null;
}

/** Relay card warnings (kind injection), hidden text first, then direction controls. */
export function questionWarnings(removed: Removed): Warning[] {
  const out: Warning[] = [];
  const hidden = removed.tagText.join(' ').replace(/\s+/g, ' ').trim();
  if (hidden) out.push({ kind: 'injection', message: QUESTION_COPY.hiddenTextWarning(truncateGraphemes(hidden, HIDDEN_QUOTE_MAX_UNITS)) });
  if (removed.bidi > 0) out.push({ kind: 'injection', message: QUESTION_COPY.bidiWarning });
  return out;
}

/** The clean trace step ("Removed {n} hidden characters from the question"), or null. */
export function questionTrace(removed: Removed, at: number): TraceStep | null {
  const n = removed.invisible + removed.bidi + removed.tagText.reduce((sum, t) => sum + [...t].length, 0);
  if (n === 0) return null;
  return { kind: 'clean', label: QUESTION_COPY.hiddenTrace(n), where: 'code', ms: 0, at };
}
