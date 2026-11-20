import { COPY } from '../../shared/labels';
import s from '../ui.module.css';

export function ConnectingState() {
  return (
    <section className={s.state} aria-label={COPY.status.connecting}>
      <p className={s.body}>{COPY.connecting}</p>
    </section>
  );
}
