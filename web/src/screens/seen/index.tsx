// What has AI seen? (40 section 13.7): a receipt for every share, with filters and the audit badge.
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button/Button';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { SEEN } from '@/copy/screens-controls';
import { SCREENS, TITLES } from '@/copy/strings';
import { useAudit } from '@/state/audit';
import { filterReceipts, useReceipts } from '@/state/receipts';
import { useRecords } from '@/state/records';
import { useSession } from '@/state/session';
import { AuditBadge } from './AuditBadge';
import { ReceiptFilters } from './ReceiptFilters';
import { ReceiptList } from './ReceiptList';
import styles from './seen.module.css';

const SKELETON_ROWS = 4;

export function Component() {
  useDocumentTitle(TITLES.seen);
  const uid = useSession((s) => s.user?.uid);
  const [attempt, setAttempt] = useState(0);
  const [now] = useState(() => Date.now());
  const { status, receipts, filters, limit } = useReceipts(
    useShallow((s) => ({ status: s.status, receipts: s.receipts, filters: s.filters, limit: s.limit })),
  );
  const meta = useRecords((s) => s.meta);

  useEffect(() => {
    if (!uid) return undefined;
    return useReceipts.getState().start('real', uid);
  }, [uid, attempt]);
  useEffect(() => useAudit.getState().start(), []);

  const ids = useMemo(() => [...new Set(receipts.flatMap((r) => r.itemIds))], [receipts]);
  useEffect(() => {
    if (ids.length > 0) useRecords.getState().ensure('real', ids).catch(console.error);
  }, [ids]);

  const ais = useMemo(() => [...new Set(receipts.map((r) => r.requester.aiName))].sort((a, b) => a.localeCompare(b)), [receipts]);
  const shown = useMemo(() => filterReceipts(receipts, filters, now), [receipts, filters, now]);

  let body;
  if (status === 'idle' || status === 'loading') {
    body = (
      <div className={styles.list} aria-busy="true">
        <span className="visually-hidden">{SEEN.loading}</span>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className={styles.row}>
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className={styles.state}>
        <p className={styles.stateText}>{SEEN.loadError}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {SEEN.tryAgain}
        </Button>
      </div>
    );
  } else if (receipts.length === 0) {
    body = (
      <div className={styles.state}>
        <p className={styles.stateText}>{SEEN.empty}</p>
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className={styles.state}>
        <p className={styles.stateText}>{SEEN.filteredEmpty}</p>
        <Button variant="secondary" onClick={() => useReceipts.getState().clearFilters()}>
          {SEEN.clearFilters}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <ReceiptList variant="real" receipts={shown} meta={meta} now={now} />
        {receipts.length >= limit ? (
          <div>
            <Button variant="secondary" onClick={() => useReceipts.getState().showMore()}>
              {SEEN.showMore}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader title={SCREENS.seen.heading} lead={SCREENS.seen.lead} size="page" actions={<AuditBadge />} />
      {status === 'ready' && receipts.length > 0 ? <ReceiptFilters ais={ais} filters={filters} /> : null}
      {body}
      <p className={styles.note}>{SEEN.note}</p>
    </div>
  );
}
