// What the in-app and Playground ApprovalCard shows for a useAsk state (40 sections 12.3 and 16.11): the composed
// options, whether approving is possible and why not, and the card phase. Pure, so both screens share it.
import { MAX_PAYLOAD_CHARS, stepPhrase, type StepOption } from '@sieve/shared';
import type { AskState } from '@/state/ask';
import { DECISION_COPY } from '@/copy/screens-main';
import { composeOptions, type Compose } from './composedOptions';

export type AskViewInput = Pick<AskState, 'phase' | 'proposal' | 'step' | 'relatedSelected' | 'relatedOptions' | 'relatedLoading'>;

export interface AskCardView {
  composed: StepOption[];
  selected: StepOption;
  canApprove: boolean;
  approveBlockedReason?: string;
  cardPhase: 'open' | 'deciding' | 'decided';
  stepPhrase: string;
  itemCount: number;
}

export function askCardView(s: AskViewInput, opts: { online: boolean; compose: Compose }): AskCardView | null {
  const proposal = s.proposal;
  if (!proposal) return null;
  const ready = s.relatedSelected.filter((id) => s.relatedOptions[id] !== undefined);
  const composed = composeOptions(proposal.options, ready.map((id) => s.relatedOptions[id]), opts.compose);
  const selected = composed.find((o) => o.step === s.step) ?? composed[0];
  const loading = s.relatedSelected.some((id) => s.relatedLoading.includes(id) || s.relatedOptions[id] === undefined);
  let reason: string | undefined;
  if (!opts.online) reason = DECISION_COPY.offlineInApp;
  else if (loading) reason = DECISION_COPY.relatedLoading;
  else if (selected.chars > MAX_PAYLOAD_CHARS) reason = DECISION_COPY.tooLong;
  else if (!selected.available) reason = DECISION_COPY.stepUnavailable;
  const itemCount = 1 + ready.length;
  return {
    composed,
    selected,
    canApprove: s.phase === 'ready' && proposal.outcome === 'ready' && reason === undefined,
    approveBlockedReason: reason,
    cardPhase: s.phase === 'drafting' || s.phase === 'done' ? 'decided' : 'open',
    stepPhrase: stepPhrase(s.step, proposal.item?.kind, itemCount),
    itemCount,
  };
}
