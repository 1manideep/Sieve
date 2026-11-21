// What has AI seen? (40 section 13.7; design handoff of Nov 20, 2026): totals on the ground, a search and filters,
// then every receipt as a row grouped by day, opened in place. The receipts come from the list MainLayout keeps.
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { assistantKindOf, type AssistantKind } from '@/components/AssistantMark/assistants';
import { Button } from '@/components/Button/Button';
import { useDb } from '@/components/dbTables';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { SEEN, SENTENCE, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { SCREENS, TITLES } from '@/copy/strings';
import { useAudit } from '@/state/audit';
import { readAutoApproved } from '@/state/autoApprove';
import { isShared, sharedItemCount, useReceipts } from '@/state/receipts';
import { useRecords } from '@/state/records';
import { useSession } from '@/state/session';
import type { ReceiptView } from '@/state/types';
import ground from '../settings/kit/ground.module.css';
import kit from '../settings/kit/kit.module.css';
import { ScreenHead } from '../settings/kit/ScreenHead';
import { useRecordCount } from '../sources/sourcesDb';
import { AuditBadge } from './AuditBadge';
import { ReceiptRows, matchesQuery } from './ReceiptRows';
import styles from './seen.module.css';

const SKELETON_ROWS = 4;
const WEEK_MS = 7 * 86_400_000;
const BAR_COLORS: Record<AssistantKind, string> = {
  claude: '#D97757',
  claudeCode: '#B85F42',
  gemini: '#8E7CF8',
  geminiCli: '#4F8BFF',
  chatgpt: '#FFFFFF',
  cursor: 'rgba(255, 255, 255, 0.7)',
  other: 'rgba(255, 255, 255, 0.45)',
};

/** The totals, from the loaded receipts: counts and characters, never the content. */
export function receiptTotals(receipts: ReceiptView[], now: number) {
  const shared = receipts.filter(isShared);
  const byAi = new Map<string, number>();
  for (const r of shared) byAi.set(r.requester.aiName, (byAi.get(r.requester.aiName) ?? 0) + 1);
  return {
    week: shared.filter((r) => r.createdAt >= now - WEEK_MS).length,
    chars: shared.reduce((sum, r) => sum + r.chars, 0),
    byAi: [...byAi.entries()].sort((a, b) => b[1] - a[1]),
    sharedItems: sharedItemCount(receipts),
  };
}

export function Component() {
  useDocumentTitle(TITLES.seen);
  const uid = useSession((s) => s.user?.uid);
  const [now] = useState(() => Date.now());
  const { status, receipts, limit } = useReceipts(useShallow((s) => ({ status: s.status, receipts: s.receipts, limit: s.limit })));
  const meta = useRecords((s) => s.meta);
  const items = useRecordCount(useDb('real'));
  const [query, setQuery] = useState('');
  const [ai, setAi] = useState('all');
  const [nothingOnly, setNothingOnly] = useState(false);
  // Read again with each receipts snapshot: the home base marks a receipt as it approves it automatically.
  const autoApproved = useMemo(() => (uid && receipts.length > 0 ? readAutoApproved(uid) : undefined), [uid, receipts]);

  useEffect(() => useAudit.getState().start(), []);

  const ids = useMemo(() => [...new Set(receipts.flatMap((r) => r.itemIds))], [receipts]);
  useEffect(() => {
    if (ids.length > 0) useRecords.getState().ensure('real', ids).catch(console.error);
  }, [ids]);

  const ais = useMemo(() => [...new Set(receipts.map((r) => r.requester.aiName))].sort((a, b) => a.localeCompare(b)), [receipts]);
  const totals = useMemo(() => receiptTotals(receipts, now), [receipts, now]);
  const shown = useMemo(
    () => receipts.filter((r) => (ai === 'all' || r.requester.aiName === ai) && (!nothingOnly || !isShared(r)) && matchesQuery(r, meta, query)),
    [receipts, ai, nothingOnly, meta, query],
  );
  const clear = () => {
    setQuery('');
    setAi('all');
    setNothingOnly(false);
  };
  const sharedTotal = totals.byAi.reduce((n, [, count]) => n + count, 0);

  let body;
  if (status === 'idle' || status === 'loading') {
    body = (
      <div className={styles.state} aria-busy="true">
        <span className="visually-hidden">{SEEN.loading}</span>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} lines={2} />
        ))}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className={styles.state}>
        <p className={kit.text}>{SEEN.loadError}</p>
        <Button variant="secondary" onClick={() => useReceipts.getState().refresh('real')}>
          {SEEN.tryAgain}
        </Button>
      </div>
    );
  } else if (receipts.length === 0) {
    body = (
      <div className={styles.state}>
        <p className={kit.text}>{SEEN.empty}</p>
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className={styles.state}>
        <p className={kit.text}>{SEEN.filteredEmpty}</p>
        <Button variant="secondary" onClick={clear}>
          {SEEN.clearFilters}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <ReceiptRows receipts={shown} meta={meta} now={now} autoApproved={autoApproved} />
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
      <ScreenHead title={SCREENS.seen.heading} tryNow actions={<AuditBadge />} />

      {status === 'ready' ? (
        <section className={`${ground.totals} ${styles.totals}`} aria-label={SEEN.totalsLabel}>
          <div>
            <span className={ground.big}>{formatCount(totals.week)}</span>
            <span className={ground.totalLabel}>{SEEN.statWeek}</span>
          </div>
          <div>
            <span className={`${ground.big} ${ground.bigAccent}`}>{formatCount(totals.chars)}</span>
            <span className={ground.totalLabel}>{SEEN.statLeft}</span>
          </div>
          <div>
            {sharedTotal > 0 ? (
              <>
                <div className={ground.splitBar} aria-hidden="true">
                  {totals.byAi.map(([name, count]) => (
                    <span key={name} style={{ width: `${(count / sharedTotal) * 100}%`, background: BAR_COLORS[assistantKindOf(name)] }} />
                  ))}
                </div>
                <div className={ground.legend}>
                  {totals.byAi.slice(0, 4).map(([name, count]) => (
                    <span key={name}>
                      <AssistantMark kind={assistantKindOf(name)} size={22} />
                      <bdi>{name}</bdi>
                      <b>{formatCount(count)}</b>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <span className={kit.small}>{SEEN.statNoShares}</span>
            )}
            <span className={ground.totalLabel}>{SEEN.statByAi}</span>
          </div>
          <div>
            <span className={ground.big}>{items === undefined ? '…' : formatCount(Math.max(0, items - totals.sharedItems))}</span>
            <span className={ground.totalLabel}>{SEEN.statNever}</span>
          </div>
        </section>
      ) : null}

      {status === 'ready' && receipts.length > 0 ? (
        <div className={styles.filters}>
          <label className={`${ground.search} ${styles.search}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <span className="visually-hidden">{SEEN.searchLabel}</span>
            <input type="search" value={query} placeholder={SEEN.searchPlaceholder} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className={ground.chips} role="group" aria-label={SEEN.assistantLabel}>
            <button type="button" className={ground.chip} aria-pressed={ai === 'all'} onClick={() => setAi('all')}>
              {SEEN.allAssistants}
            </button>
            {ais.map((name) => (
              <button key={name} type="button" className={ground.chip} aria-pressed={ai === name} onClick={() => setAi(name)}>
                <AssistantMark kind={assistantKindOf(name)} size={18} />
                <bdi>{name}</bdi>
              </button>
            ))}
          </div>
          <button type="button" className={ground.chip} aria-pressed={nothingOnly} onClick={() => setNothingOnly((v) => !v)}>
            {SEEN.nothingChip}
          </button>
          <span className={styles.count} role="status">
            {fillText(SEEN.countText, { n: formatCount(shown.length), total: formatCount(receipts.length) })}
          </span>
        </div>
      ) : null}

      {body}
      <p className={kit.sentence}>{SENTENCE}</p>
    </div>
  );
}
