// LadderControl (40 section 16.3): the need-to-know ladder as a radiogroup. Unavailable steps are skipped by the
// arrow keys and ignored on click; each one gets a reason line. Selection follows focus (roving tabIndex).
import { useId, useRef, type KeyboardEvent } from 'react';
import { LADDER_LABELS, LADDER_STEPS, fullStepLabel, ladderSegmentLabel, type ItemKind, type LadderStep, type StepOption } from '@sieve/shared';
import { LADDER_COPY, fill } from '@/copy/screens-main';
import { nextRadioIndex, tabStopIndex } from '../Segmented/rovingRadio';
import styles from './LadderControl.module.css';

export interface LadderControlProps {
  label: string;                    // "Share the least it can" (in-app) | "What {aiName} would receive" (relay)
  options: StepOption[];            // the three composed options, LADDER_STEPS order
  value: LadderStep;
  onChange(step: LadderStep): void;
  kind?: ItemKind;                  // for "3 · Full email"; undefined: "3 · Full item"
  requestedStep?: LadderStep;       // relay only
  aiName?: string;
  disabled?: boolean;               // after a decision
  previewId: string;                // aria-controls target (the OutgoingPreview region)
  labelHidden?: boolean;            // the gate names the ladder in its own title; the label stays for screen readers
}

/** "Answer only", "Excerpt", "Full email": the step name without its number. */
export function stepLabel(step: LadderStep, kind?: ItemKind): string {
  return step === 'full' ? fullStepLabel(kind) : LADDER_LABELS[step];
}

export function LadderControl({ label, options, value, onChange, kind, requestedStep, aiName, disabled = false, previewId, labelHidden = false }: LadderControlProps) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const byStep = LADDER_STEPS.map((step) => options.find((o) => o.step === step));
  const enabled = byStep.map((o) => Boolean(o?.available) && !disabled);
  const selected = LADDER_STEPS.indexOf(value);
  const stop = tabStopIndex(selected, disabled ? byStep.map(() => false) : enabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const from = refs.current.findIndex((el) => el === document.activeElement);
    const next = nextRadioIndex(from === -1 ? stop : from, event.key, enabled);
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    if (LADDER_STEPS[next] !== value) onChange(LADDER_STEPS[next]);
  };

  const aboveRequested =
    requestedStep !== undefined && LADDER_STEPS.indexOf(value) > LADDER_STEPS.indexOf(requestedStep);
  const unavailable = byStep.filter((o): o is StepOption => o !== undefined && !o.available);

  return (
    <div className={styles.ladder}>
      <p id={labelId} className={labelHidden ? 'visually-hidden' : styles.label}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-controls={previewId}
        aria-disabled={disabled || undefined}
        className={styles.group}
        onKeyDown={onKeyDown}
      >
        {LADDER_STEPS.map((step, i) => {
          const option = byStep[i];
          const available = Boolean(option?.available);
          const checked = step === value;
          return (
            <button
              key={step}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={!available || disabled || undefined}
              tabIndex={i === stop ? 0 : -1}
              className={[
                styles.segment,
                checked ? styles.checked : '',
                !available ? styles.unavailable : '',
                disabled ? styles.locked : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                if (!available || disabled || checked) return;
                onChange(step);
              }}
            >
              {ladderSegmentLabel(step, kind)}
            </button>
          );
        })}
      </div>
      {unavailable.length > 0 ? (
        <ul className={styles.reasons}>
          {unavailable.map((o) => (
            <li key={o.step}>
              {fill(LADDER_COPY.reasonLine, { step: stepLabel(o.step, kind), reason: o.unavailableReason ?? '' })}
            </li>
          ))}
        </ul>
      ) : null}
      {aboveRequested && aiName ? <p className={styles.more}>{fill(LADDER_COPY.moreThanAsked, { aiName })}</p> : null}
    </div>
  );
}
