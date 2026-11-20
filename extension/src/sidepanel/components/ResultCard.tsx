// The selected request just resolved (50 sections 8.3 and 8.4), shown until the person presses Done.
import { useId } from 'react';
import type { ResolvedEntry } from '../../shared/internal';
import { COPY, resultCopy } from '../../shared/labels';
import s from '../ui.module.css';
import { Tag } from './Basics';
import { RequesterLine } from './RequestCard';

export function ResultCard({ entry, onDone }: { entry: ResolvedEntry; onDone(): void }) {
  const headingId = useId();
  const copy = resultCopy(entry);
  return (
    <article className={s.card} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.h2}>
        {copy.heading}
      </h2>
      <RequesterLine aiName={entry.aiName} question={entry.question} />
      <p className={s.body}>{copy.body}</p>
      {copy.tag ? <Tag tone={copy.tag.tone}>{copy.tag.text}</Tag> : null}
      <div className={s.actions}>
        <button type="button" className={s.secondary} onClick={onDone}>
          {COPY.done}
        </button>
      </div>
    </article>
  );
}
