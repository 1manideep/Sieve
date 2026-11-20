// ReceiptList (40 section 13.7; F5): one row per receipt, never the content, in one glass table: Question,
// Assistant, Step, Chars, When and (variant "real") Revoke. The newest row is tinted; blocked rows read in the
// never colour, declined rows in the waiting colour. variant="playground" is the same table without Revoke. Under
// 760px the rows stack (seen.module.css); the explicit table roles keep the semantics when the display changes.
import { useState, type ReactNode } from 'react';
import { LADDER_LABELS, type LadderStep } from '@sieve/shared';
import { Button } from '@/components/Button/Button';
import { SEEN, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { useReceipts } from '@/state/receipts';
import type { RecordMeta } from '@/state/records';
import { useToasts } from '@/state/toasts';
import type { ReceiptView } from '@/state/types';
import { Confirm } from '../settings/kit/Confirm';
import { Fill, Iso } from '../settings/kit/Fill';
import kit from '../settings/kit/kit.module.css';
import { formatDayTime, isoTime } from '../settings/kit/when';
import styles from './seen.module.css';

export interface ReceiptListProps {
  variant: 'real' | 'playground';
  receipts: ReceiptView[];
  meta: Record<string, RecordMeta | null>;
  now?: number;
  /** Receipt ids this computer approved automatically (40 section 13.8.9): "Approved automatically". */
  autoApproved?: ReadonlySet<string>;
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

/** Something left the device for this receipt (or will, once collected). */
export function isShared(r: ReceiptView): boolean {
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

/** The Step cell: the step that left (or the category that stopped it), then who decided and the status. */
function StepCell({ receipt, meta, auto }: { receipt: ReceiptView; meta: Record<string, RecordMeta | null>; auto: boolean }) {
  const aiName = receipt.requester.aiName;
  let main: ReactNode = null;
  if (isShared(receipt) || receipt.status === 'expired') {
    const step = receipt.step ?? 'answer';
    main = <span className={step === 'full' ? kit.warn : undefined}>{stepLabel(step)}</span>;
  } else {
    const category = receipt.itemIds[0] ? meta[receipt.itemIds[0]]?.category : undefined;
    if (category) main = <span className={receipt.status === 'blocked' ? kit.never : kit.warn}>{category}</span>;
  }

  let by: string | undefined;
  if (receipt.status === 'declined') by = SEEN.byDeclined;
  else if (receipt.decidedBy === 'rule') by = SEEN.byRule;
  else if (receipt.decidedBy === 'extension') by = SEEN.byExtension;
  else if (receipt.decidedBy === 'app') by = auto ? SEEN.byAuto : SEEN.byApp;

  let status: string | undefined;
  switch (receipt.status) {
    case 'pending-collection':
      status = fillText(SEEN.statusPending, { aiName });
      break;
    case 'delivered':
      status = SEEN.statusDelivered;
      break;
    case 'revoked':
      status = SEEN.statusRevoked;
      break;
    case 'declined':
    case 'blocked':
      status = SEEN.statusNothingLeft;
      break;
    case 'expired':
      status = SEEN.statusExpired;
      break;
  }

  return (
    <div className={styles.stepStack}>
      {main}
      <span className={styles.subline}>
        {by ? <span>{by}</span> : null}
        {by && status ? <span aria-hidden="true"> · </span> : null}
        {status ? <span>{status}</span> : null}
      </span>
    </div>
  );
}

export function ReceiptList({ variant, receipts, meta, now: nowProp, autoApproved }: ReceiptListProps) {
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
      <div className={`${kit.glassSm} ${styles.tableWrap}`}>
        <table role="table" className={styles.table} aria-label={SEEN.listLabel}>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">{SEEN.colQuestion}</th>
              <th role="columnheader" scope="col">{SEEN.colAssistant}</th>
              <th role="columnheader" scope="col">{SEEN.colStep}</th>
              <th role="columnheader" scope="col">{SEEN.colChars}</th>
              <th role="columnheader" scope="col">{SEEN.colWhen}</th>
              {variant === 'real' ? (
                <th role="columnheader" scope="col">
                  <span className="visually-hidden">{SEEN.colActions}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {receipts.map((r, i) => {
              const outside = r.requester.kind === 'outside';
              const revocable = variant === 'real' && outside && (r.status === 'delivered' || r.status === 'pending-collection');
              const wasRevoked = variant === 'real' && outside && (r.status === 'revoked' || revoked.includes(r.id));
              const left = r.chars > 0 && r.status !== 'expired';
              return (
                <tr role="row" key={r.id} data-status={r.status} className={i === 0 ? styles.newest : undefined}>
                  <td role="cell" className={styles.cellQuestion}>
                    <p className={styles.who} dir="auto">
                      <WhoLine receipt={r} variant={variant} />
                    </p>
                    <p className={styles.what} dir="auto">
                      <WhatLine receipt={r} meta={meta} />
                    </p>
                  </td>
                  <td role="cell" className={styles.cellAi}>
                    <bdi>{r.requester.aiName}</bdi>
                  </td>
                  <td role="cell" className={styles.cellStep}>
                    <StepCell receipt={r} meta={meta} auto={autoApproved?.has(r.id) === true} />
                  </td>
                  <td role="cell" className={styles.cellChars}>
                    <span className={styles.charsNumber} aria-hidden="true">
                      {left ? formatCount(r.chars) : '0'}
                    </span>
                    <span className={styles.charsText}>{left ? fillText(SEEN.charsLeft, { chars: formatCount(r.chars) }) : SEEN.nothingLeft}</span>
                  </td>
                  <td role="cell" className={styles.when}>
                    <time dateTime={isoTime(r.createdAt)}>{formatDayTime(r.createdAt, now)}</time>
                  </td>
                  {variant === 'real' ? (
                    <td role="cell" className={styles.cellAction}>
                      {wasRevoked ? (
                        <Button variant="danger" size="sm" disabled>
                          {SEEN.revoked}
                        </Button>
                      ) : revocable ? (
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={fillText(SEEN.revokeLabel, { aiName: r.requester.aiName })}
                          onClick={() => setConfirming(r)}
                        >
                          {SEEN.revoke}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
