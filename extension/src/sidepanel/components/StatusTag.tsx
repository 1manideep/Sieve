// The status line under the name (board F8): a dot and the mono text. The text carries the meaning, never the
// colour alone (50 section 8.7).
import type { ConnectionState } from '../../shared/internal';
import { COPY } from '../../shared/labels';
import s from '../ui.module.css';

const STATUS_DOT: Record<ConnectionState, string | undefined> = {
  connected: s.dotOk,
  'not-home-base': s.dotOk,
  connecting: s.dotWait,
  disconnected: s.dotOff,
};

export function StatusTag({ connection }: { connection: ConnectionState }) {
  return (
    <span className={s.status}>
      <span className={`${s.dot} ${STATUS_DOT[connection] ?? ''}`} aria-hidden="true" />
      {COPY.status[connection]}
    </span>
  );
}
