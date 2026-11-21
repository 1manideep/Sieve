// Account (40 section 13.8.8; design handoff of Nov 20, 2026): one row with the Google photo, who is signed in and
// Sign out; under "More", the row that deletes the account with a typed DELETE and a live checklist (10.7).
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button/Button';
import { Dialog } from '@/components/Dialog/Dialog';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { Icon } from '@/components/icons';
import { Spinner } from '@/components/Spinner/Spinner';
import { SETTINGS } from '@/copy/screens-controls';
import { ACCOUNT } from '@/copy/strings';
import { useSession } from '@/state/session';
import { runDeleteAccount, type DeleteStep } from './accountService';
import kit from './kit/kit.module.css';
import ground from './kit/ground.module.css';
import styles from './settings.module.css';

const STEPS: Exclude<DeleteStep, 'done'>[] = ['stopping', 'push', 'account', 'device'];

export function AccountCard() {
  const user = useSession((s) => s.user);
  const navigate = useNavigate();
  // The photo that failed to load, so the initial shows instead and a new account's photo is tried again.
  const [brokenPhoto, setBrokenPhoto] = useState<string | null>(null);
  const email = user?.email ?? user?.displayName ?? '';
  const photo = user?.photoURL && user.photoURL !== brokenPhoto ? user.photoURL : null;

  return (
    <ErrorBoundary>
      <section id="account" className={ground.sec} aria-labelledby="account-heading">
        <h2 id="account-heading" className={ground.h2} tabIndex={-1}>
          {SETTINGS.accountHeading}
        </h2>
        <ul className={ground.rows} aria-label={SETTINGS.accountHeading}>
          <li className={ground.row}>
            <span className={styles.who}>
              {photo ? (
                <img className={styles.avatar} src={photo} alt="" width={40} height={40} referrerPolicy="no-referrer" onError={() => setBrokenPhoto(photo)} />
              ) : (
                <span className={styles.avatar} aria-hidden="true">
                  {(email[0] ?? '?').toUpperCase()}
                </span>
              )}
              <span className={ground.rowText}>
                <bdi>{ACCOUNT.signedInAs(email)}</bdi>
                <span className={ground.rowSub}>{SETTINGS.accountSub}</span>
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                useSession
                  .getState()
                  .signOut()
                  .then(() => navigate('/'))
                  .catch(console.error);
              }}
            >
              {SETTINGS.signOut}
            </Button>
          </li>
        </ul>
      </section>
    </ErrorBoundary>
  );
}

/** Delete my account, as a row under "More": the button opens the typed-DELETE dialog. */
export function DeleteAccountRow() {
  const [open, setOpen] = useState(false);
  return (
    <li className={ground.row}>
      <span className={ground.rowText}>
        <span>{SETTINGS.deleteHeading}</span>
        <span className={ground.rowSub}>{SETTINGS.deleteText}</span>
      </span>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        {SETTINGS.deleteButton}
      </Button>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </li>
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
