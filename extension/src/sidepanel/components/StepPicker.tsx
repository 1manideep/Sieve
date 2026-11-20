// The ladder as a radiogroup (50 sections 8.5 and 8.7): roving tabindex, arrows skip unavailable steps, Space
// selects. Unavailable steps are aria-disabled, with the reason as a title and as visually hidden text.
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { LADDER_STEPS } from '@sieve/shared';
import type { LadderStep, ProposalPreview } from '@sieve/shared';
import { COPY, stepLabel } from '../../shared/labels';
import { isStepEnabled, optionFor } from '../steps';
import s from '../ui.module.css';
import { VisuallyHidden } from './Basics';

interface StepPickerProps {
  preview: ProposalPreview;
  value: LadderStep | null;
  locked: boolean;
  onChange(step: LadderStep): void;
}

export function StepPicker({ preview, value, locked, onChange }: StepPickerProps) {
  const labelId = useId();
  const reasonId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = LADDER_STEPS.map((step) => isStepEnabled(preview, step));
  const focusIndex = value !== null ? LADDER_STEPS.indexOf(value) : Math.max(0, enabled.indexOf(true));
  const n = LADDER_STEPS.length;
  const reasons = LADDER_STEPS.map((step, i) =>
    enabled[i] ? undefined : (optionFor(preview, step)?.unavailableReason ?? COPY.stepUnavailable),
  );

  function choose(i: number) {
    const step = LADDER_STEPS[i];
    if (locked || !step || !enabled[i]) return;
    onChange(step);
  }

  function move(from: number, delta: 1 | -1) {
    if (locked) return;
    for (let k = 1; k <= n; k++) {
      const i = (((from + delta * k) % n) + n) % n;
      if (enabled[i]) {
        choose(i);
        buttons.current[i]?.focus();
        return;
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(i, -1);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      choose(i);
    }
  }

  return (
    <div className={s.ladder}>
      <p id={labelId} className={s.label}>
        {COPY.ladderLabel}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} aria-disabled={locked || undefined} className={s.steps}>
        {LADDER_STEPS.map((step, i) => {
          const disabled = !enabled[i];
          const reason = reasons[i];
          return (
            <button
              key={step}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === step}
              aria-disabled={disabled || locked || undefined}
              aria-describedby={reason ? `${reasonId}-${step}` : undefined}
              title={reason}
              tabIndex={i === focusIndex ? 0 : -1}
              className={`${s.step} ${value === step ? s.stepSelected : ''} ${disabled ? s.stepDisabled : ''}`}
              onClick={() => choose(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {stepLabel(step)}
            </button>
          );
        })}
      </div>
      {LADDER_STEPS.map((step, i) => {
        const reason = reasons[i];
        return reason ? (
          <VisuallyHidden key={step} id={`${reasonId}-${step}`}>
            {`${stepLabel(step)}: ${reason}`}
          </VisuallyHidden>
        ) : null;
      })}
    </div>
  );
}
