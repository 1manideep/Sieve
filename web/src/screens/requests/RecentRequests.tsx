// RecentRequests (40 section 13.5; F5 "Earlier today"): the request docs of the last 24 hours, newest first, as rows
// in one small glass card. The table's rows are stacked (assistant and time, the question, the status), so it fits
// the narrow column and a phone; the explicit table roles keep the semantics when the display changes.
import type { RequestStatus } from '@sieve/shared';
import { Tag, type TagProps } from '@/components/Tag/Tag';
import { REQUESTS, fillText } from '@/copy/screens-controls';
import type { RelayRequestView } from '@/state/types';
import kit from '../settings/kit/kit.module.css';
import { formatDayTime, isoTime } from '../settings/kit/when';
import styles from './requests.module.css';

const DAY_MS = 24 * 3_600_000;

const TONES: Record<RequestStatus, TagProps['tone']> = {
  queued: 'muted',
  claimed: 'muted',
  'awaiting-person': 'warn',
  answered: 'cloud',
  collected: 'cloud',
  declined: 'muted',
  blocked: 'never',
  'no-match': 'muted',
  unsupported: 'muted',
  expired: 'muted',
  revoked: 'muted',
  offline: 'muted',
  error: 'warn',
};

export function statusLabel(request: RelayRequestView): string {
  return fillText(REQUESTS.status[request.status], { aiName: request.requester.aiName });
}

export function RecentRequests({ recent, now }: { recent: RelayRequestView[]; now: number }) {
  const rows = recent.filter((r) => r.createdAt >= now - DAY_MS);
  return (
    <section className={`${kit.glassSm} ${styles.recent}`} aria-labelledby="recent-requests-heading">
      <h2 id="recent-requests-heading" className={kit.sectionTitle}>
        {REQUESTS.recentHeading}
      </h2>
      {rows.length === 0 ? (
        <p className={kit.small}>{REQUESTS.recentEmpty}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table role="table" className={styles.table}>
            <caption className="visually-hidden">{REQUESTS.recentCaption}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">{REQUESTS.colWhen}</th>
                <th role="columnheader" scope="col">{REQUESTS.colAi}</th>
                <th role="columnheader" scope="col">{REQUESTS.colQuestion}</th>
                <th role="columnheader" scope="col">{REQUESTS.colStatus}</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((r) => (
                <tr role="row" key={r.id} data-status={r.status}>
                  <td role="cell" className={styles.when}>
                    <time dateTime={isoTime(r.createdAt)}>{formatDayTime(r.createdAt, now)}</time>
                  </td>
                  <td role="cell" className={styles.cellAi}>
                    <bdi>{r.requester.aiName}</bdi>
                  </td>
                  <td role="cell" className={styles.cellQuestion} dir="auto">
                    {r.question}
                  </td>
                  <td role="cell" className={styles.cellStatus}>
                    <Tag tone={TONES[r.status]}>{statusLabel(r)}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={kit.note}>{REQUESTS.recentSub}</p>
    </section>
  );
}
