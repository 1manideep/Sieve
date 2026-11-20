// DecisionBar (40 section 16.11). A blocked approve stays focusable (aria-disabled) with its reason described.
// There is no keyboard shortcut for approving or denying, on purpose.
import { useId } from 'react';
import { DECISION_COPY } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import styles from './DecisionBar.module.css';

export interface DecisionBarProps {
  variant: 'in-app' | 'relay';
  canApprove: boolean;
  approveBlockedReason?: string;
  busy?: 'approve' | 'deny';
  onApprove(): void;
  onDeny(): void;
}

export function DecisionBar({ variant, canApprove, approveBlockedReason, busy, onApprove, onDeny }: DecisionBarProps) {
  const reasonId = useId();
  const blocked = !canApprove;
  const working = busy !== undefined;
  const approve = (
    <Button
      variant="primary"
      aria-disabled={blocked || working || undefined}
      aria-describedby={blocked && approveBlockedReason ? reasonId : undefined}
      busy={busy === 'approve'}
      onClick={() => {
        if (blocked || working) return;
        onApprove();
      }}
    >
      {variant === 'relay' ? DECISION_COPY.relayApprove : DECISION_COPY.inAppApprove}
    </Button>
  );
  const deny = (
    <Button
      variant={variant === 'relay' ? 'danger' : 'secondary'}
      aria-disabled={working || undefined}
      busy={busy === 'deny'}
      onClick={() => {
        if (working) return;
        onDeny();
      }}
    >
      {variant === 'relay' ? DECISION_COPY.relayDeny : DECISION_COPY.inAppDeny}
    </Button>
  );
  return (
    <div className={styles.bar}>
      <div className={styles.buttons}>
        {variant === 'relay' ? (
          <>
            {approve}
            {deny}
          </>
        ) : (
          <>
            {deny}
            {approve}
          </>
        )}
      </div>
      {blocked && approveBlockedReason ? (
        <p id={reasonId} className={styles.reason}>
          {approveBlockedReason}
        </p>
      ) : null}
    </div>
  );
}
