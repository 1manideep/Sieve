// Validating a decision before anything is written (40 section 11.8, 01 section 6, 50 section 6.2 rule 7).
import { LADDER_STEPS, MAX_PAYLOAD_CHARS, type Decision, type LadderStep, type StepOption } from '@sieve/shared';
import type { composeOutgoingText } from '@/pipeline';
import type { DecideResult, PendingEntry } from '@/state/homeBase';
import { DECIDE_ERRORS } from '@/copy/strings';
import { decisionDeadline } from './deadline';

export type DecisionInput = { requestId: string; approved: boolean; step?: LadderStep; decidedBy: 'app' | 'extension' };
export type DecideResultReason = Extract<DecideResult, { ok: false }>['reason'];

function stepIndex(step: LadderStep): number {
  return LADDER_STEPS.indexOf(step);
}

/**
 * Checks, in order: the entry waits for the person; the decision window is open; the step is allowed and available
 * for every item; the composed text fits. Returns the decision to finalize and the exact text the person saw.
 * The extension approves the main item only (its itemIds are always []); its decidedAt is replaced with now.
 * A decline needs only the first two checks, whatever the proposal's outcome.
 */
export function validateDecision(
  entry: PendingEntry | undefined,
  input: DecisionInput,
  now: number,
  compose: typeof composeOutgoingText,
):
  | { ok: true; decision: Decision; text: string }
  | { ok: false; reason: DecideResultReason; message: string } {
  const proposal = entry?.proposal;
  if (!entry || entry.phase !== 'awaiting-person' || !proposal || (input.approved && proposal.outcome !== 'ready')) {
    return { ok: false, reason: 'not-pending', message: DECIDE_ERRORS.notPending };
  }
  if (!(now < decisionDeadline(entry.request))) {
    return { ok: false, reason: 'expired', message: DECIDE_ERRORS.expired };
  }
  const mainId = proposal.item?.recordId;
  if (!input.approved) {
    return {
      ok: true,
      decision: { requestId: input.requestId, approved: false, itemIds: mainId ? [mainId] : [], decidedBy: input.decidedBy, decidedAt: now },
      text: '',
    };
  }
  const step = input.step;
  const invalid = { ok: false as const, reason: 'invalid-step' as const, message: DECIDE_ERRORS.invalidStep };
  if (!step || !LADDER_STEPS.includes(step) || !mainId) return invalid;
  if (stepIndex(step) > stepIndex(proposal.maxStep)) return invalid;
  const main = proposal.options[stepIndex(step)];
  if (!main || main.step !== step || !main.available) return invalid;
  const related = input.decidedBy === 'app' ? entry.relatedSelected : [];
  const parts: StepOption[] = [main];
  for (const id of related) {
    const o = entry.relatedOptions[id]?.[stepIndex(step)];
    if (!o || !o.available) return invalid;
    parts.push(o);
  }
  const text = compose(parts);
  if (text.length > MAX_PAYLOAD_CHARS) return { ok: false, reason: 'too-long', message: DECIDE_ERRORS.tooLong };
  if (text.length === 0) return invalid;
  return {
    ok: true,
    decision: { requestId: input.requestId, approved: true, step, itemIds: [mainId, ...related], decidedBy: input.decidedBy, decidedAt: now },
    text,
  };
}
