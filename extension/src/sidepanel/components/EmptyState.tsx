import { COPY } from '../../shared/labels';
import s from '../ui.module.css';

export function EmptyState() {
  return (
    <section className={s.state} aria-labelledby="sieve-empty">
      <h2 id="sieve-empty" className={s.h2}>
        {COPY.empty.heading}
      </h2>
      <p className={s.body}>{COPY.empty.body}</p>
    </section>
  );
}
