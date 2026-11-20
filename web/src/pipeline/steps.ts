// Small shared helpers of the pipeline (10 section 12.1).
import { DEFAULT_CATEGORY_RULES, LADDER_STEPS } from '@sieve/shared';
import type { Category, CategoryRule, IndexRecord, LadderStep, Settings, StepOption } from '@sieve/shared';

/** The person's rule for a category; a category missing from settings uses DEFAULT_CATEGORY_RULES. */
export function ruleFor(settings: Pick<Settings, 'categoryRules'>, category: Category): CategoryRule {
  return settings.categoryRules?.[category] ?? DEFAULT_CATEGORY_RULES[category];
}

export function stepIndex(step: LadderStep): number {
  return LADDER_STEPS.indexOf(step);
}

/** Playground seeds are sample data; everything else (Gmail, folder, uploads, visitor files) is the person's own. */
export function recordDataClass(r: Pick<IndexRecord, 'source'>): 'own' | 'sample' {
  return r.source === 'playground' ? 'sample' : 'own';
}

/** Pure; the only builder of outgoing text with related items (01 section 11.4). Main item first. */
export function composeOutgoingText(options: StepOption[]): string {
  return options.map((o) => o.text).join('\n\n');
}

export function unavailableOption(step: LadderStep, reason: string): StepOption {
  return { step, text: '', chars: 0, redactions: 0, available: false, unavailableReason: reason };
}

export function unavailableOptions(reason: string): StepOption[] {
  return LADDER_STEPS.map((step) => unavailableOption(step, reason));
}
