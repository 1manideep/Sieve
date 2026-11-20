// Step rules for the request card (50 section 8.5).
import { LADDER_STEPS } from '@sieve/shared';
import type { LadderStep, ProposalPreview, StepOption } from '@sieve/shared';
import { stepIndex } from '../shared/labels';

export function optionFor(p: ProposalPreview, step: LadderStep): StepOption | undefined {
  return p.options.find((o) => o.step === step);
}

/** A step can be chosen only when its option is available and it is not above maxStep. */
export function isStepEnabled(p: ProposalPreview, step: LadderStep): boolean {
  const option = optionFor(p, step);
  return option !== undefined && option.available && stepIndex(step) <= stepIndex(p.maxStep);
}

/** requestedStep if available; otherwise the highest available step below it; otherwise none. */
export function defaultStep(p: ProposalPreview): LadderStep | null {
  for (let i = stepIndex(p.requestedStep); i >= 0; i--) {
    const step = LADDER_STEPS[i];
    if (step && isStepEnabled(p, step)) return step;
  }
  return null;
}

/** The person's choice while it stays allowed, else the default. */
export function effectiveStep(p: ProposalPreview, chosen: LadderStep | undefined): LadderStep | null {
  return chosen !== undefined && isStepEnabled(p, chosen) ? chosen : defaultStep(p);
}
