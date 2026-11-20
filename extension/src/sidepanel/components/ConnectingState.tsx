import { COPY } from '../../shared/labels';
import s from '../ui.module.css';
import { Glyph } from './Basics';

export function ConnectingState() {
  return (
    <section className={s.state} aria-label={COPY.status.connecting}>
      <Glyph dim />
      <p className={s.stateBody}>{COPY.connecting}</p>
    </section>
  );
}
