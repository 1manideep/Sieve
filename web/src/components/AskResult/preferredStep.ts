// The ladder on the prompt card (F2) chooses the step before a question exists. When the proposal arrives the store
// starts from the settings' default step; this applies the person's choice instead, through the store's own setStep,
// at the highest available step at or below it (40 section 12.2).
import { useEffect, useRef, useState } from 'react';
import type { LadderStep } from '@sieve/shared';
import { useShallow } from 'zustand/shallow';
import type { AskStore } from './AskResult';
import { startingStep } from '../ApprovalCard/composedOptions';

export function usePreferredStep(useAsk: AskStore, initial: LadderStep): [LadderStep, (step: LadderStep) => void] {
  const [preferred, setPreferred] = useState<LadderStep>(initial);
  const { phase, requestId } = useAsk(useShallow((s) => ({ phase: s.phase, requestId: s.requestId })));
  const applied = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (phase !== 'ready' || !requestId || applied.current === requestId) return;
    applied.current = requestId;
    const s = useAsk.getState();
    if (!s.proposal || s.proposal.outcome !== 'ready') return;
    const step = startingStep(s.proposal.options, preferred);
    if (step !== s.step) s.setStep(step);
  }, [phase, requestId, preferred, useAsk]);
  return [preferred, setPreferred];
}
