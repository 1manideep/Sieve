// HistoryDetail (F11): a finished request from the history, in the right pane: who asked, when, the question, the
// outcome in words, and the way to its receipt on "What has AI seen?".
import { Link } from 'react-router-dom';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { assistantKindOf } from '@/components/AssistantMark/assistants';
import { Tag } from '@/components/Tag/Tag';
import { REQUESTS } from '@/copy/screens-controls';
import type { RelayRequestView } from '@/state/types';
import kit from '../settings/kit/kit.module.css';
import { formatDayTime, isoTime } from '../settings/kit/when';
import { statusLabel } from './labels';
import styles from './requests.module.css';

export function HistoryDetail({ request, now }: { request: RelayRequestView; now: number }) {
  const answered = request.status === 'answered' || request.status === 'collected';
  return (
    <article className={`${kit.glass} ${styles.card}`} aria-label={REQUESTS.selectedLabel}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>
          <AssistantMark kind={assistantKindOf(request.requester.aiName)} size={22} />{' '}
          <bdi className={styles.eyebrowAi}>{request.requester.aiName}</bdi>
        </p>
        <time className={styles.time} dateTime={isoTime(request.createdAt)}>
          {formatDayTime(request.createdAt, now)}
        </time>
      </div>
      <p className={styles.question} dir="auto">
        {request.question}
      </p>
      <p>
        <Tag tone={answered ? 'cloud' : request.status === 'blocked' ? 'never' : 'muted'}>{statusLabel(request)}</Tag>
      </p>
      {request.message ? <p className={kit.text}>{request.message}</p> : null}
      {answered ? (
        <p>
          <Link to="/seen" className={styles.receiptLink}>
            {REQUESTS.seeReceipt}
          </Link>
        </p>
      ) : null}
    </article>
  );
}
