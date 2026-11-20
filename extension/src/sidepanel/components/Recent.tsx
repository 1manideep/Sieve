// Other resolved requests, compact (50 section 8.3): newest first, kept by the worker for 10 minutes.
import { useId } from 'react';
import type { ResolvedEntry } from '../../shared/internal';
import { COPY, resultCopy } from '../../shared/labels';
import s from '../ui.module.css';

export function Recent({ entries }: { entries: ResolvedEntry[] }) {
  const headingId = useId();
  if (entries.length === 0) return null;
  return (
    <section className={s.list} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.h3}>
        {COPY.recent}
      </h3>
      <ul className={s.rows}>
        {entries.map((r) => (
          <li key={r.requestId} className={s.recentRow}>
            <strong>{resultCopy(r).heading}</strong> · <bdi>{r.aiName}</bdi>: <span dir="auto">{`"${r.question}"`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
