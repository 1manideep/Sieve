// Dialog and ConfirmDialog (40 section 7.7): the native <dialog> opened with showModal() (focus trap, top layer,
// ::backdrop). Focus moves inside on open and returns to the opener on close.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DIALOG_COPY } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { Icon } from '../icons';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  title: string;                       // h2, aria-labelledby
  description?: string;                // aria-describedby
  onClose(): void;                     // Esc and the close button, unless dismissible === false
  dismissible?: boolean;               // default true
  initialFocus?: 'first-field' | 'primary' | 'close';   // default 'first-field'
  size?: 'sm' | 'md' | 'lg';           // max width 440 | 560 | 720 px
  children?: ReactNode;
  footer?: ReactNode;                  // right-aligned buttons, primary last
}

const FIELDS = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

function DialogOpen({ title, description, onClose, dismissible = true, initialFocus = 'first-field', size = 'md', children, footer }: Omit<DialogProps, 'open'>) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const dismissibleRef = useRef(dismissible);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    dismissibleRef.current = dismissible;
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof el.showModal === 'function') {
      if (!el.open) el.showModal();
    } else {
      el.setAttribute('open', '');
    }
    const field = bodyRef.current?.querySelector<HTMLElement>(FIELDS) ?? null;
    const buttons = footerRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    const primary = buttons && buttons.length > 0 ? buttons[buttons.length - 1] : null;
    const target =
      initialFocus === 'close'
        ? closeRef.current ?? primary
        : initialFocus === 'primary'
          ? primary ?? closeRef.current
          : field ?? primary ?? closeRef.current;
    target?.focus();
    return () => {
      if (typeof el.close === 'function' && el.open) el.close();
      else el.removeAttribute('open');
      if (opener && document.contains(opener)) opener.focus();
    };
    // Mount only: the opener and the first focus are taken once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Native <dialog> fires "cancel" on Esc; the fallback (no showModal) listens for the key itself.
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (dismissibleRef.current) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || typeof el.showModal === 'function') return;
      event.preventDefault();
      if (dismissibleRef.current) onCloseRef.current();
    };
    el.addEventListener('cancel', onCancel);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[size]}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      aria-modal="true"
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {dismissible ? (
          <button ref={closeRef} type="button" className={styles.close} aria-label={DIALOG_COPY.close} onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        ) : null}
      </div>
      {description ? (
        <p id={descId} className={styles.description}>
          {description}
        </p>
      ) : null}
      {children ? (
        <div ref={bodyRef} className={styles.body}>
          {children}
        </div>
      ) : null}
      {footer ? (
        <div ref={footerRef} className={styles.footer}>
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

export function Dialog({ open, ...rest }: DialogProps) {
  if (!open) return null;
  return <DialogOpen {...rest} />;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  onConfirm(): void | Promise<void>;
  onCancel(): void;
}

/** A confirm preset: while the action runs, the confirm button shows a spinner, both buttons are disabled and Esc is ignored. */
export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'default', onConfirm, onCancel }: ConfirmDialogProps) {
  const [running, setRunning] = useState(false);

  const confirm = async () => {
    setRunning(true);
    try {
      await onConfirm();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      description={body}
      onClose={onCancel}
      dismissible={!running}
      initialFocus="primary"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={running}>
            {DIALOG_COPY.cancel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => void confirm()} disabled={running} busy={running}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
