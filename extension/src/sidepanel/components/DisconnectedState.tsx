import { COPY } from '../../shared/labels';
import s from '../ui.module.css';
import { Glyph } from './Basics';

export function DisconnectedState({ onOpenApp }: { onOpenApp(): void }) {
  return (
    <section className={s.state} aria-labelledby="sieve-disconnected">
      <Glyph off />
      <h2 id="sieve-disconnected" className={s.stateHeading}>
        {COPY.disconnected.heading}
      </h2>
      <p className={s.stateBody}>{COPY.disconnected.body}</p>
      <button type="button" className={`${s.btnWhite} ${s.stateAction}`} onClick={onOpenApp}>
        {COPY.openSieve}
      </button>
    </section>
  );
}
