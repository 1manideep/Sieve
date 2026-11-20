// Approve and Deny (50 sections 8.4 and 8.5): Approve is the blue pill across the row, Deny the outline pill.
// While a decision is in flight both are disabled and the pressed one says "Sending…"; once the worker marks it
// slow they re-enable.
import type { InflightEntry } from '../../shared/internal';
import { COPY } from '../../shared/labels';
import s from '../ui.module.css';

interface DecisionButtonsProps {
  showApprove: boolean;
  canApprove: boolean;
  inflight?: InflightEntry;
  onApprove(): void;
  onDeny(): void;
}

export function DecisionButtons({ showApprove, canApprove, inflight, onApprove, onDeny }: DecisionButtonsProps) {
  const busy = inflight !== undefined && !inflight.slow;
  const approving = busy && inflight.approved;
  const denying = busy && !inflight.approved;
  return (
    <div className={s.actions}>
      {showApprove ? (
        <button
          type="button"
          className={`${s.btnPrimary} ${s.grow}`}
          disabled={busy || !canApprove}
          aria-busy={approving || undefined}
          onClick={onApprove}
        >
          {approving ? COPY.sending : COPY.approve}
        </button>
      ) : null}
      <button
        type="button"
        className={`${s.btnOutline} ${showApprove ? '' : s.grow}`}
        disabled={busy}
        aria-busy={denying || undefined}
        onClick={onDeny}
      >
        {denying ? COPY.sending : COPY.deny}
      </button>
    </div>
  );
}
