// DecisionBar (40 section 16.11). A blocked approve stays focusable (aria-disabled) with its reason described.
// There is no keyboard shortcut for approving or denying, on purpose. The final design, in the chat's gate and on
// Requests alike: the blue "Approve, N characters", then a text button ("Keep it here" in the app, "Decline" for an
// outside assistant), then an optional note in mono at the right (characters and masked details).
import { useId, type ReactNode } from 'react';
import { formatCount } from '@/copy/format';
import { DECISION_COPY, fill } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import styles from './DecisionBar.module.css';

export interface DecisionBarProps {
  variant: 'in-app' | 'relay';
  canApprove: boolean;
  approveBlockedReason?: string;
  busy?: 'approve' | 'deny';
  onApprove(): void;
  onDeny(): void;
  /** The characters that would leave, in the Approve label. */
  chars?: number;
  /** The mono note at the right of the row (characters and masked details). */
  note?: ReactNode;
}

/** "Approve, 41 characters"; without a count, "Approve" (in-app) or "Approve and send" (an outside assistant). */
export function approveLabel(variant: 'in-app' | 'relay', chars?: number): string {
  if (chars !== undefined) return fill(DECISION_COPY.approveChars, { chars: formatCount(chars) });
  return variant === 'relay' ? DECISION_COPY.relayApprove : DECISION_COPY.inAppApprovePlain;
}

export function DecisionBar({ variant, canApprove, approveBlockedReason, busy, onApprove, onDeny, chars, note }: DecisionBarProps) {
  const reasonId = useId();
  const blocked = !canApprove;
  const working = busy !== undefined;
  return (
    <div className={styles.bar} data-variant={variant}>
      <div className={styles.buttons}>
        <Button
          variant="primary"
          tone="blue"
          className={styles.approve}
          aria-disabled={blocked || working || undefined}
          aria-describedby={blocked && approveBlockedReason ? reasonId : undefined}
          busy={busy === 'approve'}
          onClick={() => {
            if (blocked || working) return;
            onApprove();
          }}
        >
          {approveLabel(variant, chars)}
        </Button>
        <Button
          variant="ghost"
          className={styles.keep}
          aria-disabled={working || undefined}
          busy={busy === 'deny'}
          onClick={() => {
            if (working) return;
            onDeny();
          }}
        >
          {variant === 'relay' ? DECISION_COPY.relayDeny : DECISION_COPY.inAppDeny}
        </Button>
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
      {blocked && approveBlockedReason ? (
        <p id={reasonId} className={styles.reason}>
          {approveBlockedReason}
        </p>
      ) : null}
    </div>
  );
}
