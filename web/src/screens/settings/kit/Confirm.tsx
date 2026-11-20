// A confirm on top of Dialog (40 section 7.7): title, body, confirm label, tone, and a cancel label that defaults to
// "Cancel" (13.8.2 and 13.8.4 need "Go back" and "Keep never"). While the action runs, the confirm button shows a
// spinner, both buttons are disabled and Esc is ignored.
import { useState } from 'react';
import { Button } from '@/components/Button/Button';
import { Dialog } from '@/components/Dialog/Dialog';
import { CONFIRM } from '@/copy/screens-controls';

export interface ConfirmProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm(): void | Promise<void>;
  onCancel(): void;
}

export function Confirm({ open, title, body, confirmLabel, cancelLabel = CONFIRM.cancel, tone = 'default', onConfirm, onCancel }: ConfirmProps) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      description={body}
      onClose={() => {
        if (!busy) onCancel();
      }}
      dismissible={!busy}
      initialFocus="primary"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => void confirm()} busy={busy} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
}
