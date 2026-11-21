// TestEmailComposer (40 section 13.9): write an email that tries to trick the AI. The hidden part is invisible in a
// normal mail app; Sieve should remove it before any model reads the email. "Try a trick" fills the form with one of
// four real tricks (Nov 21), so a visitor can see each one caught with one click and one question.
import { useId, useState, type FormEvent } from 'react';
import type { TestEmailInput } from '@/state/playground';
import { TEST_EMAIL_COPY } from '@/copy/screens-main';
import { Button } from '@/components/Button/Button';
import { Chip } from '@/components/Chip/Chip';
import { hideModeOf, TRICK_EMAILS, type TrickEmail } from '@/playground/testEmail';
import styles from './playground.module.css';

export interface TestEmailComposerProps {
  id?: string;
  busy?: boolean;
  /** `question` names the trick's sender, so search finds the email; absent when the visitor wrote their own. */
  onAdd(input: TestEmailInput, question?: string): void;
  onCancel(): void;
}

export function TestEmailComposer({ id, busy = false, onAdd, onCancel }: TestEmailComposerProps) {
  const [trick, setTrick] = useState<TrickEmail | null>(TRICK_EMAILS[0] ?? null);
  const [value, setValue] = useState<TestEmailInput>(TRICK_EMAILS[0]?.input ?? { from: '', subject: '', body: '', hidden: '', hideAsWhiteText: true });
  const ids = {
    from: useId(), subject: useId(), body: useId(), hidden: useId(), white: useId(), help: useId(), title: useId(),
    tricks: useId(), how: useId(),
  };
  const set = <K extends keyof TestEmailInput>(k: K, v: TestEmailInput[K]) => setValue((prev) => ({ ...prev, [k]: v }));
  const pick = (t: TrickEmail) => {
    setTrick(t);
    setValue({ ...t.input });
  };
  const mode = hideModeOf(value);
  const setWhite = (on: boolean) => setValue((prev) => ({ ...prev, hideAsWhiteText: on, hideAs: on ? 'white' : 'visible' }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The trick's question names its sender; once the visitor renames the sender, it would no longer find the email.
    onAdd(value, trick && value.from === trick.input.from ? trick.question : undefined);
  };
  return (
    <form id={id} className={styles.composer} onSubmit={submit} aria-labelledby={ids.title} aria-describedby={ids.help}>
      <h3 id={ids.title} className="visually-hidden">
        {TEST_EMAIL_COPY.title}
      </h3>
      <div className={styles.tricks} role="group" aria-labelledby={ids.tricks} aria-describedby={ids.how}>
        <p id={ids.tricks} className={styles.tricksLabel}>
          {TEST_EMAIL_COPY.tricksLabel}
        </p>
        <div className={styles.trickChips}>
          {TRICK_EMAILS.map((t) => (
            <Chip key={t.id} shape="rounded" selectedStyle="inverse" selected={trick?.id === t.id} onClick={() => pick(t)}>
              {t.label}
            </Chip>
          ))}
        </div>
        <p id={ids.how} className={styles.help} aria-live="polite">
          {trick ? trick.how : TEST_EMAIL_COPY.tricksHelp}
        </p>
      </div>
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
      {mode === 'tags' ? (
        <p className={styles.help}>{TEST_EMAIL_COPY.hiddenAsTags}</p>
      ) : (
        <label className={styles.checkRow} htmlFor={ids.white}>
          <input id={ids.white} type="checkbox" checked={mode === 'white'} onChange={(e) => setWhite(e.target.checked)} />
          {TEST_EMAIL_COPY.hideAsWhiteText}
        </label>
      )}
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
