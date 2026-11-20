// The exact outgoing text (50 section 8.5): options[selected].text, nothing added, trimmed or reformatted, and
// URLs stay text. Under the box, the meta line (characters, redactions) in mono and, when nothing was flagged,
// the clean line with its green dot on the right (board F8).
import { useId } from 'react';
import type { StepOption } from '@sieve/shared';
import { COPY, outgoingMeta } from '../../shared/labels';
import s from '../ui.module.css';

export function CleanLine() {
  return (
    <span className={s.clean}>
      <span className={`${s.dot} ${s.dotOk}`} aria-hidden="true" />
      {COPY.cleanTag}
    </span>
  );
}

export function OutgoingText({ option, clean }: { option: StepOption; clean: boolean }) {
  const labelId = useId();
  return (
    <section className={s.outgoing} aria-labelledby={labelId}>
      <p id={labelId} className={s.label}>
        {COPY.outgoingLabel}
      </p>
      <div className={s.outgoingBox} dir="auto" tabIndex={0} data-testid="outgoing-text">
        {option.text}
      </div>
      <div className={s.metaRow}>
        <span className={s.meta}>{outgoingMeta(option.chars, option.redactions)}</span>
        {clean ? <CleanLine /> : null}
      </div>
    </section>
  );
}
