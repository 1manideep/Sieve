// PendingList (40 section 13.5): the waiting requests rail. Items link to ?id=; read-only rows for requests that
// wait on another computer or in another tab have no approval controls.
import { Link } from 'react-router-dom';
import { Tag, type TagProps } from '@/components/Tag/Tag';
import { REQUESTS, fillText } from '@/copy/screens-controls';
import type { PendingEntry } from '@/state/homeBase';
import type { RelayRequestView } from '@/state/types';
import { formatClock, isoTime } from '../settings/kit/when';
import styles from './requests.module.css';

export interface PhaseTag { label: string; tone: TagProps['tone'] }

export function phaseTag(entry: PendingEntry): PhaseTag {
  switch (entry.phase) {
    case 'claiming':
    case 'preparing':
      return { label: REQUESTS.phasePreparing, tone: 'muted' };
    case 'awaiting-person':
    case 'deciding':
      return { label: REQUESTS.phaseWaiting, tone: 'warn' };
    case 'done': {
      const r = entry.result;
      if (!r) return { label: REQUESTS.phaseWaiting, tone: 'warn' };
      if (r.kind === 'sent') return { label: REQUESTS.phaseSent, tone: 'device' };
      if (r.kind === 'declined') return { label: REQUESTS.phaseDeclined, tone: 'muted' };
      if (r.kind === 'ended') return { label: r.status === 'expired' ? REQUESTS.phaseExpired : REQUESTS.phaseCancelled, tone: 'muted' };
      if (r.status === 'blocked') return { label: REQUESTS.phaseBlocked, tone: 'never' };
      if (r.status === 'no-match') return { label: REQUESTS.phaseNoMatch, tone: 'muted' };
      return { label: REQUESTS.phaseError, tone: 'warn' };
    }
  }
}

export interface PendingListProps {
  entries: PendingEntry[];
  readOnly: RelayRequestView[];
  readOnlyLabel: string;
  selectedId?: string;
  waitingCount: number;
}

export function PendingList({ entries, readOnly, readOnlyLabel, selectedId, waitingCount }: PendingListProps) {
  return (
    <nav aria-label={REQUESTS.pendingNav} className={styles.rail}>
      <h2 className={styles.railHeading}>{fillText(REQUESTS.pendingHeading, { n: waitingCount })}</h2>
      <ul className={styles.railList}>
        {entries.map((entry) => {
          const tag = phaseTag(entry);
          const selected = entry.requestId === selectedId;
          return (
            <li key={entry.requestId}>
              <Link
                to={{ search: `?id=${encodeURIComponent(entry.requestId)}` }}
                className={selected ? `${styles.item} ${styles.itemSelected}` : styles.item}
                aria-current={selected ? 'true' : undefined}
              >
                <RowBody request={entry.request} tag={tag} />
              </Link>
            </li>
          );
        })}
        {readOnly.map((request) => (
          <li key={request.id} className={styles.item}>
            <RowBody request={request} tag={{ label: readOnlyLabel, tone: 'muted' }} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function RowBody({ request, tag }: { request: RelayRequestView; tag: PhaseTag }) {
  return (
    <span className={styles.itemBody}>
      <span className={styles.itemTop}>
        <bdi className={styles.itemAi}>{request.requester.aiName}</bdi>
        <time className={styles.itemTime} dateTime={isoTime(request.createdAt)}>
          {formatClock(request.createdAt)}
        </time>
      </span>
      <span className={styles.itemQuestion} dir="auto">
        {request.question}
      </span>
      <span>
        <Tag tone={tag.tone}>{tag.label}</Tag>
      </span>
    </span>
  );
}
