// What has AI seen? (40 section 13.7; docs/design/final-flow.md F5): four numbers from the receipts this screen has
// loaded, then every receipt as a row in one glass table, with filters and the audit badge.
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button/Button';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { SEEN, SENTENCE } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { SCREENS, TITLES } from '@/copy/strings';
import { useAudit } from '@/state/audit';
import { filterReceipts, useReceipts } from '@/state/receipts';
import { useRecords } from '@/state/records';
import { useSession } from '@/state/session';
import type { ReceiptView } from '@/state/types';
import kit from '../settings/kit/kit.module.css';
import { ScreenHead } from '../settings/kit/ScreenHead';
import { AuditBadge } from './AuditBadge';
import { ReceiptFilters } from './ReceiptFilters';
import { ReceiptList, isShared } from './ReceiptList';
import styles from './seen.module.css';

const SKELETON_ROWS = 4;
const DAYS_30 = 30 * 86_400_000;

/** The four numbers at the top, from the loaded receipts: counts and characters, never the content. */
export function receiptStats(receipts: ReceiptView[], now: number) {
  const shared = receipts.filter(isShared);
  return {
    shares30: shared.filter((r) => r.createdAt >= now - DAYS_30).length,
    chars: shared.reduce((sum, r) => sum + r.chars, 0),
    whole: shared.filter((r) => r.step === 'full').length,
    blocked: receipts.filter((r) => r.status === 'blocked' || r.status === 'declined').length,
  };
}

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
  const stats = useMemo(() => receiptStats(receipts, now), [receipts, now]);

  let body;
  if (status === 'idle' || status === 'loading') {
    body = (
      <div className={`${kit.glassSm} ${styles.skeletonList}`} aria-busy="true">
        <span className="visually-hidden">{SEEN.loading}</span>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className={styles.skeletonRow}>
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className={`${kit.glassSm} ${styles.state}`}>
        <p className={kit.text}>{SEEN.loadError}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {SEEN.tryAgain}
        </Button>
      </div>
    );
  } else if (receipts.length === 0) {
    body = (
      <div className={`${kit.glassSm} ${styles.state}`}>
        <p className={kit.text}>{SEEN.empty}</p>
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className={`${kit.glassSm} ${styles.state}`}>
        <p className={kit.text}>{SEEN.filteredEmpty}</p>
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
    <div className={kit.screen}>
      <ScreenHead
        title={SCREENS.seen.heading}
        tryNow
        actions={
          <>
            <AuditBadge />
            {status === 'ready' && receipts.length > 0 ? (
              // The same range as the When filter below: pressed, only the last 30 days are listed.
              <button
                type="button"
                className={styles.rangePill}
                aria-pressed={filters.range === '30d'}
                onClick={() => useReceipts.getState().setFilter('range', filters.range === '30d' ? 'any' : '30d')}
              >
                {SEEN.range30d}
              </button>
            ) : null}
          </>
        }
      />
      {status === 'ready' ? (
        <div className={styles.stats}>
          <Stat value={stats.shares30} label={SEEN.statShares} />
          <Stat value={stats.chars} label={SEEN.statChars} accent />
          <Stat value={stats.whole} label={SEEN.statFull} />
          <Stat value={stats.blocked} label={SEEN.statBlocked} />
        </div>
      ) : null}
      {status === 'ready' && receipts.length > 0 ? <ReceiptFilters ais={ais} filters={filters} /> : null}
      {body}
      <p className={kit.small}>{SEEN.note}</p>
      <p className={kit.sentence}>{SENTENCE}</p>
    </div>
  );
}

function Stat({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={accent ? `${kit.bigNumber} ${kit.accent}` : kit.bigNumber}>{formatCount(value)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
