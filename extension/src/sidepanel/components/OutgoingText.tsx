// The exact outgoing text (50 section 8.5): options[selected].text, nothing added, trimmed or reformatted, and
// URLs stay text.
import { useId } from 'react';
import type { StepOption } from '@sieve/shared';
import { COPY, outgoingMeta } from '../../shared/labels';
import s from '../ui.module.css';

export function OutgoingText({ option }: { option: StepOption }) {
  const labelId = useId();
  return (
    <section className={s.outgoing} aria-labelledby={labelId}>
      <p id={labelId} className={s.label}>
        {COPY.outgoingLabel}
      </p>
      <div className={s.outgoingBox} dir="auto" tabIndex={0} data-testid="outgoing-text">
        {option.text}
      </div>
      <p className={s.meta}>{outgoingMeta(option.chars, option.redactions)}</p>
    </section>
  );
}
