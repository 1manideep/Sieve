// PromptCard (the final design, F2): one glass card with the question as a bare field and a bottom row: attach, the
// ladder (Answer / Excerpt / Full), the small Nano label, the mic, and the big white Ask button that the
// screen passes in (it holds the submit rules). Also the round submit and the step chip of the follow-up pill (F3).
import { forwardRef, useId, type ReactNode } from 'react';
import { LADDER_STEPS, type LadderStep } from '@sieve/shared';
import { ASK_COPY } from '@/copy/screens-main';
import { QuestionInput, type QuestionInputHandle } from '../QuestionInput/QuestionInput';
import { Segmented } from '../Segmented/Segmented';
import { useDictation } from './dictation';
import { Glyph } from './glyphs';
import type { ModelPill } from './modelPill';
import styles from './PromptCard.module.css';

export interface PromptCardProps {
  /** The card's region name ("Ask about your own data"); the field keeps its own label. */
  regionLabel: string;
  label: string;
  placeholder: string;
  value: string;
  onChange(q: string): void;
  onSubmit(q: string): void;
  /** The submit (or Stop) button: the screen decides what it says and when it is blocked. */
  button: ReactNode;
  step: LadderStep;
  onStepChange(step: LadderStep): void;
  model: ModelPill;
  attach?: { label: string; onClick(): void };
  describedBy?: string;
  /** Rows under the field, such as "Sieve answers once the model is ready". */
  children?: ReactNode;
}

export function NanoPill({ model }: { model: ModelPill }) {
  return (
    <span className={styles.nano} data-tone={model.tone}>
      <span className={styles.nanoDot} aria-hidden="true" />
      {model.text}
    </span>
  );
}

export function MicButton({ onText, compact = false }: { onText(text: string): void; compact?: boolean }) {
  const dictation = useDictation(onText);
  if (!dictation.supported) return null;
  return (
    <button
      type="button"
      className={`${styles.round} ${compact ? styles.roundSmall : ''} ${dictation.listening ? styles.listening : ''}`}
      aria-label={dictation.listening ? ASK_COPY.micListening : ASK_COPY.mic}
      aria-pressed={dictation.listening}
      onClick={dictation.toggle}
    >
      <Glyph name="mic" size={20} />
    </button>
  );
}

/** The big white Ask of the prompt card, or the round white arrow of the follow-up pill. */
export interface AskButtonProps {
  round?: boolean;
  label: string;
  blocked?: boolean;
  describedBy?: string;
  onClick?(): void;
}

export const AskButton = forwardRef<HTMLButtonElement, AskButtonProps>(function AskButton({ round = false, label, blocked = false, describedBy, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="submit"
      className={round ? styles.roundSubmit : styles.ask}
      aria-label={round ? label : undefined}
      aria-disabled={blocked || undefined}
      aria-describedby={describedBy}
      onClick={(e) => {
        if (blocked) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
    >
      {round ? <Glyph name="up" size={18} /> : (
        <>
          {label}
          <Glyph name="arrow" size={18} />
        </>
      )}
    </button>
  );
});

export const PromptCard = forwardRef<QuestionInputHandle, PromptCardProps>(function PromptCard(
  { regionLabel, label, placeholder, value, onChange, onSubmit, button, step, onStepChange, model, attach, describedBy, children },
  ref,
) {
  const hintId = useId();
  const options = LADDER_STEPS.map((s) => ({ value: s, label: ASK_COPY.ladderSteps[s], description: ASK_COPY.ladderHints[s] }));
  return (
    <section className={styles.card} aria-label={regionLabel}>
      <QuestionInput
        ref={ref}
        variant="prompt"
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        describedBy={describedBy}
        button={button}
        leading={
          <>
            {attach ? (
              <button type="button" className={styles.round} aria-label={attach.label} onClick={attach.onClick}>
                <Glyph name="plus" size={20} />
              </button>
            ) : null}
            <div className={styles.ladder}>
              <Segmented<LadderStep> label={ASK_COPY.ladderLabel} options={options} value={step} onChange={onStepChange} describedBy={hintId} />
            </div>
            {/* what the chosen step lets out: read to a screen reader with the control, no longer shown beside it */}
            <span id={hintId} className="visually-hidden">
              {ASK_COPY.ladderHints[step]}
            </span>
          </>
        }
        trailing={
          <>
            <NanoPill model={model} />
            <MicButton onText={onChange} />
          </>
        }
      />
      {children}
    </section>
  );
});
