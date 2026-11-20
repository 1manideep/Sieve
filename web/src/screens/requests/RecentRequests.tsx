// RecentRequests (40 section 13.5): the request docs of the last 24 hours, newest first.
import type { RequestStatus } from '@sieve/shared';
import { Tag, type TagProps } from '@/components/Tag/Tag';
import { REQUESTS, fillText } from '@/copy/screens-controls';
import type { RelayRequestView } from '@/state/types';
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
    <section className={styles.recent} aria-labelledby="recent-requests-heading">
      <div>
        <h2 id="recent-requests-heading" className={styles.recentHeading}>
          {REQUESTS.recentHeading}
        </h2>
        <p className={styles.sub}>{REQUESTS.recentSub}</p>
      </div>
      {rows.length === 0 ? (
        <p className={styles.muted}>{REQUESTS.recentEmpty}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">{REQUESTS.recentCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{REQUESTS.colWhen}</th>
                <th scope="col">{REQUESTS.colAi}</th>
                <th scope="col">{REQUESTS.colQuestion}</th>
                <th scope="col">{REQUESTS.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={styles.when}>
                    <time dateTime={isoTime(r.createdAt)}>{formatDayTime(r.createdAt, now)}</time>
                  </td>
                  <td>
                    <bdi>{r.requester.aiName}</bdi>
                  </td>
                  <td className={styles.cellQuestion} dir="auto">
                    {r.question}
                  </td>
                  <td>
                    <Tag tone={TONES[r.status]}>{statusLabel(r)}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
