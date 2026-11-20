// QuestionInput: the question field shared by Ask and the Playground (40 sections 13.4 and 13.9; 70 R-IN-01 and R-IN-02):
// maxLength 500, a counter past 400, the empty-question error, the paste note, Enter submits and "/" focuses it.
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { MAX_QUESTION_CHARS } from '@sieve/shared';
import { ASK_COPY, fill } from '@/copy/screens-main';
import styles from './QuestionInput.module.css';

export const COUNTER_FROM = 400;

/** Empty after removing whitespace and invisible characters (70 R-IN-01). */
export function isBlankQuestion(q: string): boolean {
  return q.replace(/[\s\u00AD\u180E\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '') === '';
}

export interface QuestionInputHandle {
  focus(): void;
}

export interface QuestionInputProps {
  label: string;
  labelHidden?: boolean;
  placeholder: string;
  value: string;
  onChange(q: string): void;
  onSubmit(q: string): void;
  /** The submit (or Stop) button, rendered next to the field. */
  button: ReactNode;
  describedBy?: string;
  variant?: 'ask' | 'playground';
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export const QuestionInput = forwardRef<QuestionInputHandle, QuestionInputProps>(function QuestionInput(
  { label, labelHidden = false, placeholder, value, onChange, onSubmit, button, describedBy, variant = 'ask' },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const noteId = useId();
  const counterId = useId();
  const [empty, setEmpty] = useState(false);
  const [pasteNote, setPasteNote] = useState(false);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  // "/" focuses the question when focus is not in an editable field (40 section 14.2).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(document.activeElement)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isBlankQuestion(value)) {
      setEmpty(true);
      inputRef.current?.focus();
      return;
    }
    setEmpty(false);
    onSubmit(value);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').length;
    const el = event.currentTarget;
    const selected = (el.selectionEnd ?? 0) - (el.selectionStart ?? 0);
    setPasteNote(value.length - selected + pasted > MAX_QUESTION_CHARS);
  };

  const described = [describedBy, empty ? errorId : null, pasteNote ? noteId : null, value.length > COUNTER_FROM ? counterId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <form className={variant === 'ask' ? styles.questionForm : styles.questionFormCompact} onSubmit={submit} noValidate>
      <label htmlFor={inputId} className={labelHidden ? 'visually-hidden' : styles.questionLabel}>
        {label}
      </label>
      <div className={styles.questionRow}>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.questionInput}
          type="text"
          maxLength={MAX_QUESTION_CHARS}
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          aria-invalid={empty || undefined}
          aria-describedby={described || undefined}
          onChange={(e) => {
            onChange(e.target.value);
            if (empty && !isBlankQuestion(e.target.value)) setEmpty(false);
            if (e.target.value.length < MAX_QUESTION_CHARS) setPasteNote(false);
          }}
          onPaste={onPaste}
        />
        {button}
      </div>
      {value.length > COUNTER_FROM ? (
        <p id={counterId} className={styles.counter}>
          {fill(ASK_COPY.counter, { n: value.length })}
        </p>
      ) : null}
      {empty ? (
        <p id={errorId} className={styles.fieldError}>
          {ASK_COPY.empty}
        </p>
      ) : null}
      {pasteNote ? (
        <p id={noteId} className={styles.counter}>
          {ASK_COPY.pasteNote}
        </p>
      ) : null}
    </form>
  );
});
