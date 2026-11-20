import { COPY } from '../../shared/labels';
import s from '../ui.module.css';
import { Glyph } from './Basics';

export function EmptyState() {
  return (
    <section className={s.state} aria-labelledby="sieve-empty">
      <Glyph />
      <h2 id="sieve-empty" className={s.stateHeading}>
        {COPY.empty.heading}
      </h2>
      <p className={s.stateBody}>{COPY.empty.body}</p>
    </section>
  );
}
