// FollowUp (the final design, F3): the pill fixed at the bottom of the conversation column: the question field again,
// the ladder step as a small chip, the mic, the round white submit the screen passes in, and the footer line. Dock is
// that bottom strip alone, so the Ask page can keep its prompt card in the same place before the first question.
import { forwardRef, type ReactNode } from 'react';
import type { LadderStep } from '@sieve/shared';
import { ASK_COPY, CONVERSATION_COPY } from '@/copy/screens-main';
import { QuestionInput, type QuestionInputHandle } from '../QuestionInput/QuestionInput';
import { Glyph } from './glyphs';
import { MicButton } from './PromptCard';
import styles from './FollowUp.module.css';

export interface FollowUpProps {
  label: string;
  placeholder: string;
  value: string;
  onChange(q: string): void;
  onSubmit(q: string): void;
  button: ReactNode;
  step: LadderStep;
  describedBy?: string;
  children?: ReactNode;
  /** True while an approval or its draft runs: a new question would replace the one being approved. */
  disabled?: boolean;
}

/** The strip at the bottom of the conversation column: the question box, any rows under it, then the footer line. */
export function Dock({ children }: { children: ReactNode }) {
  return (
    <div className={styles.followUp}>
      {children}
      <p className={styles.note}>{CONVERSATION_COPY.footer}</p>
    </div>
  );
}

export const FollowUp = forwardRef<QuestionInputHandle, FollowUpProps>(function FollowUp(
  { label, placeholder, value, onChange, onSubmit, button, step, describedBy, children, disabled = false },
  ref,
) {
  return (
    <Dock>
      <QuestionInput
        ref={ref}
        variant="followup"
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        describedBy={describedBy}
        disabled={disabled}
        button={button}
        leading={<Glyph name="plus" size={20} className={styles.plus} />}
        trailing={
          <>
            <span className={styles.stepChip}>
              {ASK_COPY.ladderSteps[step]}
              <Glyph name="chevron" size={14} />
            </span>
            <MicButton onText={onChange} compact />
          </>
        }
      />
      {children}
    </Dock>
  );
});
