// HistoryDetail (F11): a finished request from the history, in the right pane: who asked, when, the question, the
// outcome in words, and the way to its receipt on "What has AI seen?". A request that Gmail access running out stopped
// says so in the person's words, with Reconnect while it is still needed (Nov 23).
import { Link } from 'react-router-dom';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { assistantKindOf } from '@/components/AssistantMark/assistants';
import { ReconnectGmail, needsReconnect, useGmailRow } from '@/components/GmailAccess/gmailRow';
import { Notice } from '@/components/Notice/Notice';
import { Tag } from '@/components/Tag/Tag';
import { GMAIL_ACCESS, REQUESTS, fillText } from '@/copy/screens-controls';
import type { RelayRequestView } from '@/state/types';
import kit from '../settings/kit/kit.module.css';
import { formatDayTime, isoTime } from '../settings/kit/when';
import { statusLabel } from './labels';
import styles from './requests.module.css';

/**
 * How MSG.mailNotCurrent (relay/messagesToAi.ts) starts, read here without loading the engine's chunk with this
 * screen (40 section 17.1). Requests.test checks the history row against MSG itself, so a reworded line is caught.
 */
const MAIL_NOT_CURRENT = 'Sieve could not check Gmail for newer mail';

export function HistoryDetail({ request, now }: { request: RelayRequestView; now: number }) {
  const answered = request.status === 'answered' || request.status === 'collected';
  const gmailRow = useGmailRow();
  const gmailStopped = request.message?.startsWith(MAIL_NOT_CURRENT) === true;
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
      {gmailStopped ? (
        <Notice tone="warning" actions={needsReconnect(gmailRow, now) ? <ReconnectGmail /> : undefined}>
          <p>{fillText(GMAIL_ACCESS.requestLatest, { aiName: request.requester.aiName })}</p>
        </Notice>
      ) : request.message ? (
        <p className={kit.text}>{request.message}</p>
      ) : null}
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
