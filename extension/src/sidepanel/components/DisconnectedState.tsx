import { COPY } from '../../shared/labels';
import s from '../ui.module.css';

export function DisconnectedState({ onOpenApp }: { onOpenApp(): void }) {
  return (
    <section className={s.state} aria-labelledby="sieve-disconnected">
      <h2 id="sieve-disconnected" className={s.h2}>
        {COPY.disconnected.heading}
      </h2>
      <p className={s.body}>{COPY.disconnected.body}</p>
      <div className={s.actions}>
        <button type="button" className={s.primary} onClick={onOpenApp}>
          {COPY.openSieve}
        </button>
      </div>
    </section>
  );
}
