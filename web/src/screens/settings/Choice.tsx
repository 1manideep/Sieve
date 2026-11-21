// One radio or checkbox row with its note, and the words for the three steps a connection can be capped at. Used by
// the Change limits dialog (40 section 13.8.3) and the connect panel (13.8.2).
import { useId, type ReactNode } from 'react';
import type { LadderStep } from '@sieve/shared';
import { SETTINGS } from '@/copy/screens-controls';
import styles from './settings.module.css';

export const CAP_NOTES: Record<LadderStep, string> = {
  answer: SETTINGS.capNoteAnswer,
  excerpt: SETTINGS.capNoteExcerpt,
  full: SETTINGS.capNoteFull,
};
export const CAP_LABELS: Record<LadderStep, string> = {
  answer: SETTINGS.capAnswer,
  excerpt: SETTINGS.capExcerpt,
  full: SETTINGS.capFull,
};

/** One radio or checkbox row; the note is the control's description, not part of its name. */
export function Choice(props: {
  type: 'radio' | 'checkbox';
  name?: string;
  checked: boolean;
  onChange(): void;
  label: ReactNode;
  note?: string;
}) {
  const noteId = useId();
  return (
    <div className={styles.choiceRow}>
      <label className={styles.choice}>
        <input
          type={props.type}
          name={props.name}
          checked={props.checked}
          onChange={props.onChange}
          aria-describedby={props.note ? noteId : undefined}
        />
        <span className={styles.choiceLabel}>{props.label}</span>
      </label>
      {props.note ? (
        <p id={noteId} className={styles.choiceNote}>
          {props.note}
        </p>
      ) : null}
    </div>
  );
}
