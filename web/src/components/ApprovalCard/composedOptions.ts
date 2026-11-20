// The three outgoing options with ticked related items folded in (40 section 11.10 composedOption, in-app form).
// The text comes only from the pipeline's composeOutgoingText, so the preview is exactly what is sent.
import { LADDER_STEPS, MAX_PAYLOAD_CHARS, type LadderStep, type StepOption } from '@sieve/shared';
import { COMPOSE_COPY } from '@/copy/screens-main';

export type Compose = (options: StepOption[]) => string;

function emptyOption(step: LadderStep): StepOption {
  return { step, text: '', chars: 0, redactions: 0, available: false };
}

/**
 * main: the proposal's three options. related: the built options of each ticked item that is ready, in tick order.
 * With nothing ticked the main options are returned as they are.
 */
export function composeOptions(main: StepOption[], related: StepOption[][], compose: Compose): StepOption[] {
  return LADDER_STEPS.map((step) => {
    const m = main.find((o) => o.step === step) ?? emptyOption(step);
    if (related.length === 0) return m;
    const parts = [m, ...related.map((r) => r.find((o) => o.step === step) ?? emptyOption(step))];
    const failing = parts.find((p) => !p.available);
    const text = failing ? '' : compose(parts);
    const chars = text.length;
    const tooLong = !failing && chars > MAX_PAYLOAD_CHARS;
    return {
      step,
      text,
      chars,
      redactions: parts.reduce((sum, p) => sum + p.redactions, 0),
      available: !failing && !tooLong && text !== '',
      unavailableReason: failing ? failing.unavailableReason : tooLong ? COMPOSE_COPY.tooLong : undefined,
      image: m.image,
      trace: m.trace,
    };
  });
}

/** The highest available step at or below `step`, else the lowest available above it (40 section 12.2). */
export function startingStep(options: StepOption[], step: LadderStep): LadderStep {
  const at = LADDER_STEPS.indexOf(step);
  const available = (i: number) => options.find((o) => o.step === LADDER_STEPS[i])?.available === true;
  for (let i = at; i >= 0; i -= 1) if (available(i)) return LADDER_STEPS[i];
  for (let i = at + 1; i < LADDER_STEPS.length; i += 1) if (available(i)) return LADDER_STEPS[i];
  return step;
}
