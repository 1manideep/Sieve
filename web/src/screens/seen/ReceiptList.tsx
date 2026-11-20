// ReceiptList (40 section 13.7): one row per receipt, never the content. The Playground's "What has AI seen?" tab
// reuses it with variant="playground" (no Revoke, its own "You asked" line).
import { useState, type ReactNode } from 'react';
import { LADDER_LABELS, type LadderStep } from '@sieve/shared';
import { Button } from '@/components/Button/Button';
import { Tag } from '@/components/Tag/Tag';
import { SEEN, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { useReceipts } from '@/state/receipts';
import type { RecordMeta } from '@/state/records';
import { useToasts } from '@/state/toasts';
import type { ReceiptView } from '@/state/types';
import { Confirm } from '../settings/kit/Confirm';
import { Fill, Iso } from '../settings/kit/Fill';
import { formatDayTime, isoTime } from '../settings/kit/when';
import styles from './seen.module.css';

export interface ReceiptListProps {
  variant: 'real' | 'playground';
  receipts: ReceiptView[];
  meta: Record<string, RecordMeta | null>;
  now?: number;
}

function titleOf(meta: Record<string, RecordMeta | null>, id: string | undefined): string {
  if (id === undefined) return SEEN.missingTitle;
  const m = meta[id];
  if (m === undefined) return SEEN.loadingTitle;
  return m === null ? SEEN.missingTitle : m.title;
}

function stepLabel(step: LadderStep | undefined): string {
  return LADDER_LABELS[step ?? 'answer'];
}

function isShared(r: ReceiptView): boolean {
  return r.status === 'delivered' || r.status === 'pending-collection' || r.status === 'revoked';
}

export function WhatLine({ receipt, meta }: { receipt: ReceiptView; meta: Record<string, RecordMeta | null> }): ReactNode {
  if (receipt.status === 'declined') return SEEN.declinedWhat;
  if (receipt.status === 'blocked') {
    const category = receipt.itemIds[0] ? meta[receipt.itemIds[0]]?.category : undefined;
    return category ? fillText(SEEN.blockedWhat, { category }) : SEEN.blockedWhatUnknown;
  }
  if (receipt.status === 'expired') return SEEN.expiredWhat;
  const title = <Iso>{titleOf(meta, receipt.itemIds[0])}</Iso>;
  const step = stepLabel(receipt.step);
  if (receipt.itemIds.length > 1) {
    return (
      <Fill
        template={SEEN.sharedMany}
        values={{ step, n: formatCount(receipt.itemIds.length), title, more: formatCount(receipt.itemIds.length - 1) }}
      />
    );
  }
  return <Fill template={SEEN.sharedOne} values={{ step, title }} />;
}

function WhoLine({ receipt, variant }: { receipt: ReceiptView; variant: ReceiptListProps['variant'] }) {
  const question = <Iso>{receipt.question}</Iso>;
  if (receipt.requester.kind === 'outside') {
    return <Fill template={SEEN.whoOutside} values={{ aiName: <Iso>{receipt.requester.aiName}</Iso>, question }} />;
  }
  if (variant === 'playground') return <Fill template={SEEN.whoPlayground} values={{ question }} />;
  return <Fill template={SEEN.whoInApp} values={{ question }} />;
}

function Tags({ receipt }: { receipt: ReceiptView }) {
  const aiName = receipt.requester.aiName;
  const tags: ReactNode[] = [];
  if (isShared(receipt) || receipt.status === 'expired') {
    const step = receipt.step ?? 'answer';
    tags.push(
      <Tag key="step" tone={step === 'full' ? 'warn' : 'device'}>
        {stepLabel(step)}
      </Tag>,
    );
  }
  if (receipt.status === 'declined') tags.push(<Tag key="by" tone="muted">{SEEN.byDeclined}</Tag>);
  else if (receipt.decidedBy === 'rule') tags.push(<Tag key="by" tone="muted">{SEEN.byRule}</Tag>);
  else if (receipt.decidedBy === 'extension') tags.push(<Tag key="by" tone="muted">{SEEN.byExtension}</Tag>);
  else if (receipt.decidedBy === 'app') tags.push(<Tag key="by" tone="muted">{SEEN.byApp}</Tag>);

  switch (receipt.status) {
    case 'pending-collection':
      tags.push(<Tag key="status" tone="cloud">{fillText(SEEN.statusPending, { aiName })}</Tag>);
      break;
    case 'delivered':
      tags.push(<Tag key="status" tone="cloud">{SEEN.statusDelivered}</Tag>);
      break;
    case 'revoked':
      tags.push(<Tag key="status" tone="muted">{SEEN.statusRevoked}</Tag>);
      break;
    case 'declined':
    case 'blocked':
      tags.push(<Tag key="status" tone="muted">{SEEN.statusNothingLeft}</Tag>);
      break;
    case 'expired':
      tags.push(<Tag key="status" tone="muted">{SEEN.statusExpired}</Tag>);
      break;
  }
  const left = receipt.chars > 0 && receipt.status !== 'expired';
  return (
    <>
      {tags}
      <span className={styles.chars}>
        {left ? fillText(SEEN.charsLeft, { chars: formatCount(receipt.chars) }) : SEEN.nothingLeft}
      </span>
    </>
  );
}

export function ReceiptList({ variant, receipts, meta, now: nowProp }: ReceiptListProps) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  const [confirming, setConfirming] = useState<ReceiptView | null>(null);
  const [revoked, setRevoked] = useState<string[]>([]);

  const revoke = async (receipt: ReceiptView) => {
    const aiName = receipt.requester.aiName;
    try {
      await useReceipts.getState().revoke(receipt.id);
      setRevoked((ids) => [...ids, receipt.id]);
      useToasts.getState().push({ tone: 'success', title: fillText(SEEN.revokeDone, { aiName }) });
    } catch (error) {
      console.error(error);
      useToasts.getState().push({ tone: 'error', title: SEEN.revokeFailed });
    }
    setConfirming(null);
  };

  return (
    <>
      <ul className={styles.list} aria-label={SEEN.listLabel}>
        {receipts.map((r) => {
          const outside = r.requester.kind === 'outside';
          const revocable = variant === 'real' && outside && (r.status === 'delivered' || r.status === 'pending-collection');
          const wasRevoked = variant === 'real' && outside && (r.status === 'revoked' || revoked.includes(r.id));
          return (
            <li key={r.id} className={styles.row}>
              <time className={styles.when} dateTime={isoTime(r.createdAt)}>
                {formatDayTime(r.createdAt, now)}
              </time>
              <div className={styles.whatWho}>
                <p className={styles.what} dir="auto">
                  <WhatLine receipt={r} meta={meta} />
                </p>
                <p className={styles.who} dir="auto">
                  <WhoLine receipt={r} variant={variant} />
                </p>
              </div>
              <div className={styles.tags}>
                <Tags receipt={r} />
              </div>
              {wasRevoked ? (
                <div className={styles.action}>
                  <Button variant="danger" size="sm" disabled>
                    {SEEN.revoked}
                  </Button>
                </div>
              ) : revocable ? (
                <div className={styles.action}>
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={fillText(SEEN.revokeLabel, { aiName: r.requester.aiName })}
                    onClick={() => setConfirming(r)}
                  >
                    {SEEN.revoke}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {variant === 'real' ? (
        <Confirm
          open={confirming !== null}
          title={fillText(SEEN.revokeTitle, { aiName: confirming?.requester.aiName ?? '' })}
          body={fillText(SEEN.revokeBody, { aiName: confirming?.requester.aiName ?? '' })}
          confirmLabel={SEEN.revokeConfirm}
          tone="danger"
          onCancel={() => setConfirming(null)}
          onConfirm={() => (confirming ? revoke(confirming) : undefined)}
        />
      ) : null}
    </>
  );
}
