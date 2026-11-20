// "Make this my home base" (40 section 11.2), opened from the Requests banner and the Settings device list.
import { useId, useState, type FormEvent } from 'react';
import { defaultDeviceLabel } from '@/app/deviceId';
import { Button } from '@/components/Button/Button';
import { Dialog } from '@/components/Dialog/Dialog';
import { HOME_BASE_DIALOG, REQUESTS, fillText } from '@/copy/screens-controls';
import { useHomeBase } from '@/state/homeBase';
import { useToasts } from '@/state/toasts';
import styles from './kit.module.css';

export const HOME_BASE_LABEL_MAX = 40;

export interface MakeHomeBaseDialogProps {
  open: boolean;
  onClose(): void;
}

export function MakeHomeBaseDialog({ open, onClose }: MakeHomeBaseDialogProps) {
  const role = useHomeBase((s) => s.role);
  const otherLabel = useHomeBase((s) => s.homeBaseLabel);
  const [name, setName] = useState(defaultDeviceLabel);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const inputId = useId();
  const errorId = useId();

  // Fresh values each time the dialog opens (state adjusted during render, not in an effect).
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setName(defaultDeviceLabel());
      setInvalid(false);
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const label = name.trim();
    if (label.length < 1 || label.length > HOME_BASE_LABEL_MAX) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      await useHomeBase.getState().makeThisHomeBase(label);
      onClose();
    } catch (error) {
      console.error(error);
      useToasts.getState().push({ tone: 'error', title: HOME_BASE_DIALOG.failed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={HOME_BASE_DIALOG.title}
      description={HOME_BASE_DIALOG.body}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {HOME_BASE_DIALOG.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} busy={busy} disabled={busy}>
            {HOME_BASE_DIALOG.confirm}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        {role === 'other-device' ? (
          <p className={styles.text}>
            {fillText(HOME_BASE_DIALOG.otherDevice, { label: otherLabel ?? REQUESTS.otherDeviceFallback })}
          </p>
        ) : null}
        <label className={styles.label} htmlFor={inputId}>
          {HOME_BASE_DIALOG.nameLabel}
        </label>
        <input
          id={inputId}
          className={styles.input}
          type="text"
          value={name}
          maxLength={HOME_BASE_LABEL_MAX}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(e) => {
            setName(e.target.value);
            if (invalid) setInvalid(false);
          }}
        />
        {invalid ? (
          <p id={errorId} className={styles.error}>
            {HOME_BASE_DIALOG.nameError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
