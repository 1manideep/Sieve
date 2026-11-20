// Account (40 section 13.8.8): sign out, and delete the account with a typed DELETE and a live checklist (10.7).
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button/Button';
import { Dialog } from '@/components/Dialog/Dialog';
import { Icon } from '@/components/icons';
import { Spinner } from '@/components/Spinner/Spinner';
import { SETTINGS } from '@/copy/screens-controls';
import { ACCOUNT } from '@/copy/strings';
import { useSession } from '@/state/session';
import { runDeleteAccount, type DeleteStep } from './accountService';
import kit from './kit/kit.module.css';
import { SettingsCard } from './SettingsCard';
import styles from './settings.module.css';

const STEPS: Exclude<DeleteStep, 'done'>[] = ['stopping', 'push', 'account', 'device'];

export function AccountCard() {
  const email = useSession((s) => s.user?.email ?? s.user?.displayName ?? '');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <SettingsCard id="account" title={SETTINGS.accountHeading}>
      <div className={styles.inline}>
        <p className={styles.text}>{ACCOUNT.signedInAs(email)}</p>
        <Button
          variant="secondary"
          onClick={() => {
            useSession
              .getState()
              .signOut()
              .then(() => navigate('/welcome'))
              .catch(console.error);
          }}
        >
          {SETTINGS.signOut}
        </Button>
      </div>
      <hr className={styles.divider} />
      <h3 className={`${styles.h3} ${styles.danger}`}>{SETTINGS.deleteHeading}</h3>
      <p className={styles.text}>{SETTINGS.deleteText}</p>
      <div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          {SETTINGS.deleteButton}
        </Button>
      </div>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </SettingsCard>
  );
}

function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [value, setValue] = useState('');
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<DeleteStep | undefined>(undefined);
  const formId = useId();
  const fieldId = useId();

  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setValue('');
      setRunning(false);
      setCurrent(undefined);
    }
  }

  // The service (app/services/account.ts, 40 section 10.7) navigates to /welcome and shows the toast for every
  // outcome, so the dialog only closes on success and starts over otherwise.
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value !== SETTINGS.deleteWord || running) return;
    setRunning(true);
    let result: 'ok' | 'cancelled' | 'error';
    try {
      result = await runDeleteAccount(setCurrent);
    } catch (error) {
      console.error(error);
      result = 'error';
    }
    setRunning(false);
    setCurrent(undefined);
    if (result === 'ok') onClose();
  };

  const at = current === undefined ? -1 : current === 'done' ? STEPS.length : STEPS.indexOf(current);

  return (
    <Dialog
      open={open}
      title={SETTINGS.deleteTitle}
      description={SETTINGS.deleteBody}
      onClose={() => {
        if (!running) onClose();
      }}
      dismissible={!running}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={running}>
            {SETTINGS.cancel}
          </Button>
          <Button
            variant="danger"
            type="submit"
            form={formId}
            busy={running}
            disabled={running || value !== SETTINGS.deleteWord}
          >
            {SETTINGS.deleteConfirm}
          </Button>
        </>
      }
    >
      <form id={formId} className={kit.form} onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={fieldId} className={kit.label}>
          {SETTINGS.deleteField}
        </label>
        <input
          id={fieldId}
          className={kit.input}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={running}
          onChange={(e) => setValue(e.target.value)}
        />
        {running || at >= 0 ? (
          <ul className={styles.checklist}>
            {STEPS.map((s, i) => (
              <li key={s} className={styles.checkItem}>
                {i < at ? (
                  <span className={styles.checkDone}>
                    <Icon name="check" size={16} />
                    <span className="visually-hidden">{SETTINGS.deleteStepDone}: </span>
                  </span>
                ) : i === at ? (
                  <Spinner size={16} />
                ) : (
                  <span className={styles.checkWaiting} aria-hidden="true" />
                )}
                {SETTINGS.deleteSteps[s]}
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    </Dialog>
  );
}
