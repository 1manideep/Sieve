// The Playground's "What has AI seen?" panel (40 sections 13.7 and 13.9): local receipts only, no audit badge,
// no Revoke. Receipts never hold content; titles are joined from the Playground database.
import { useEffect } from 'react';
import { LADDER_LABELS } from '@sieve/shared';
import type { ReceiptView } from '@/state/types';
import { useRecords } from '@/state/records';
import { formatCount } from '@/copy/format';
import { PLAYGROUND_COPY, PLAYGROUND_RECEIPT_COPY, fill } from '@/copy/screens-main';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Fill } from '@/components/Fill/Fill';
import { Tag } from '@/components/Tag/Tag';
import { TimeText } from '@/components/TimeText/TimeText';
import styles from './playground.module.css';

export interface PlaygroundReceiptsProps {
  receipts: ReceiptView[];
}

function whatLine(r: ReceiptView, titleOf: (id: string) => string) {
  if (r.status === 'declined') return PLAYGROUND_RECEIPT_COPY.declined;
  if (r.status === 'blocked') return null;
  if (r.status === 'expired') return PLAYGROUND_RECEIPT_COPY.expired;
  const step = r.step ? LADDER_LABELS[r.step] : LADDER_LABELS.answer;
  const title = titleOf(r.itemIds[0] ?? '');
  if (r.itemIds.length > 1) {
    return <Fill template={PLAYGROUND_RECEIPT_COPY.sharedMany} values={{ step, n: r.itemIds.length, title, more: r.itemIds.length - 1 }} />;
  }
  return <Fill template={PLAYGROUND_RECEIPT_COPY.shared} values={{ step, title }} />;
}

export function PlaygroundReceipts({ receipts }: PlaygroundReceiptsProps) {
  const meta = useRecords((s) => s.meta);
  const ids = [...new Set(receipts.flatMap((r) => r.itemIds))].join('|');
  useEffect(() => {
    if (!ids) return;
    useRecords.getState().ensure('playground', ids.split('|')).catch((error: unknown) => console.error(error));
  }, [ids]);
  const titleOf = (id: string) => meta[id]?.title ?? PLAYGROUND_RECEIPT_COPY.missingTitle;

  return (
    <div className={styles.receipts}>
      <p className={styles.panelNote}>{PLAYGROUND_COPY.receiptsNote}</p>
      {receipts.length === 0 ? (
        <EmptyState icon="shield" title={PLAYGROUND_COPY.tabSeen} body={PLAYGROUND_COPY.receiptsEmpty} />
      ) : (
        <ul className={styles.receiptList} aria-label={PLAYGROUND_RECEIPT_COPY.listLabel}>
          {receipts.map((r) => {
            const category = meta[r.itemIds[0] ?? '']?.category;
            const what = r.status === 'blocked' ? fill(PLAYGROUND_RECEIPT_COPY.blocked, { category: category ?? '' }) : whatLine(r, titleOf);
            const shared = r.status === 'delivered' || r.status === 'pending-collection';
            return (
              <li key={r.id} className={styles.receiptRow}>
                <span className={styles.receiptWhen}>
                  <TimeText at={r.createdAt} format="day-time" />
                </span>
                <span className={styles.receiptWhat}>
                  <span className={styles.receiptTitle} data-testid="receipt-what">
                    {what}
                  </span>
                  <span className={styles.receiptWho}>
                    <Fill template={PLAYGROUND_RECEIPT_COPY.who} values={{ question: r.question }} />
                  </span>
                </span>
                <span className={styles.receiptTags}>
                  {r.step && shared ? <Tag tone={r.step === 'full' ? 'warn' : 'device'}>{LADDER_LABELS[r.step]}</Tag> : null}
                  <Tag tone="muted">
                    {r.status === 'declined'
                      ? PLAYGROUND_RECEIPT_COPY.byDeclined
                      : r.decidedBy === 'rule'
                        ? PLAYGROUND_RECEIPT_COPY.byRule
                        : PLAYGROUND_RECEIPT_COPY.byApp}
                  </Tag>
                  {shared ? <Tag tone="cloud">{PLAYGROUND_RECEIPT_COPY.delivered}</Tag> : <Tag tone="muted">{PLAYGROUND_RECEIPT_COPY.nothingLeft}</Tag>}
                  <span className={styles.receiptChars}>
                    {r.chars > 0 ? fill(PLAYGROUND_RECEIPT_COPY.charsLeft, { n: formatCount(r.chars) }) : PLAYGROUND_RECEIPT_COPY.nothingLeftDevice}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
