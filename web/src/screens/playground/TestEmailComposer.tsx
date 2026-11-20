// TestEmailComposer (40 section 13.9): write an email that tries to trick the AI. The hidden part is invisible in a
// normal mail app; Sieve should remove it before any model reads the email.
import { useId, useState, type FormEvent } from 'react';
import type { TestEmailInput } from '@/state/playground';
import { TEST_EMAIL_COPY } from '@/copy/screens-main';
import { Button } from '@/components/Button/Button';
import { DEFAULT_TEST_EMAIL } from '@/playground/testEmail';
import styles from './playground.module.css';

export interface TestEmailComposerProps {
  id?: string;
  busy?: boolean;
  onAdd(input: TestEmailInput): void;
  onCancel(): void;
}

export function TestEmailComposer({ id, busy = false, onAdd, onCancel }: TestEmailComposerProps) {
  const [value, setValue] = useState<TestEmailInput>(DEFAULT_TEST_EMAIL);
  const ids = { from: useId(), subject: useId(), body: useId(), hidden: useId(), white: useId(), help: useId(), title: useId() };
  const set = <K extends keyof TestEmailInput>(k: K, v: TestEmailInput[K]) => setValue((prev) => ({ ...prev, [k]: v }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAdd(value);
  };
  return (
    <form id={id} className={styles.composer} onSubmit={submit} aria-labelledby={ids.title} aria-describedby={ids.help}>
      <h3 id={ids.title} className="visually-hidden">
        {TEST_EMAIL_COPY.title}
      </h3>
      <div className={styles.field}>
        <label htmlFor={ids.from}>{TEST_EMAIL_COPY.from}</label>
        <input id={ids.from} className={styles.input} value={value.from} maxLength={80} onChange={(e) => set('from', e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={ids.subject}>{TEST_EMAIL_COPY.subject}</label>
        <input id={ids.subject} className={styles.input} value={value.subject} maxLength={200} onChange={(e) => set('subject', e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={ids.body}>{TEST_EMAIL_COPY.body}</label>
        <textarea id={ids.body} className={styles.textarea} rows={2} value={value.body} maxLength={2000} onChange={(e) => set('body', e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={ids.hidden}>{TEST_EMAIL_COPY.hidden}</label>
        <textarea id={ids.hidden} className={styles.textarea} rows={2} value={value.hidden} maxLength={500} onChange={(e) => set('hidden', e.target.value)} />
      </div>
      <label className={styles.checkRow} htmlFor={ids.white}>
        <input id={ids.white} type="checkbox" checked={value.hideAsWhiteText} onChange={(e) => set('hideAsWhiteText', e.target.checked)} />
        {TEST_EMAIL_COPY.hideAsWhiteText}
      </label>
      <p id={ids.help} className={styles.help}>
        {TEST_EMAIL_COPY.help}
      </p>
      <div className={styles.composerButtons}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {TEST_EMAIL_COPY.cancel}
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={busy}>
          {TEST_EMAIL_COPY.add}
        </Button>
      </div>
    </form>
  );
}
