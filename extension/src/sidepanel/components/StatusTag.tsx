import type { ConnectionState } from '../../shared/internal';
import { COPY } from '../../shared/labels';
import { Tag } from './Basics';
import type { TagTone } from './Basics';

const STATUS_TONE: Record<ConnectionState, TagTone> = {
  connected: 'device',
  'not-home-base': 'muted',
  connecting: 'muted',
  disconnected: 'warn',
};

/** Status tag: the text carries the meaning, never colour alone (50 section 8.7). */
export function StatusTag({ connection }: { connection: ConnectionState }) {
  return <Tag tone={STATUS_TONE[connection]}>{COPY.status[connection]}</Tag>;
}
