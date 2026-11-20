// Requests (40 section 13.5; docs/design/final-flow.md F5): requests from connected assistants wait here for the
// person. The pending card sits left; "How a request reaches you" and "Earlier today" sit right.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { REQUESTS, SENTENCE, fillText } from '@/copy/screens-controls';
import { SCREENS, TITLES } from '@/copy/strings';
import { useHomeBase, type PendingEntry } from '@/state/homeBase';
import kit from '../settings/kit/kit.module.css';
import { MakeHomeBaseDialog } from '../settings/kit/MakeHomeBaseDialog';
import { ScreenHead } from '../settings/kit/ScreenHead';
import { PendingList } from './PendingList';
import { RecentRequests } from './RecentRequests';
import { RequestDetail } from './RequestDetail';
import { ClickNotice, GmailTokenBanner, MemorySaverTip, RoleBanner, ShortcutTip } from './RequestNotices';
import styles from './requests.module.css';

/** 40 section 13.5: ?id= if it matches; else the oldest waiting for the person; else the newest entry. */
export function selectEntry(list: PendingEntry[], id: string | null): PendingEntry | undefined {
  return (
    list.find((e) => e.requestId === id) ??
    list.find((e) => e.phase === 'awaiting-person') ??
    list[list.length - 1]
  );
}

export function Component() {
  useDocumentTitle(TITLES.requests);
  const [params] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const { role, entries, order, recent, label, awaitingCount } = useHomeBase(
    useShallow((s) => ({
      role: s.role,
      entries: s.entries,
      order: s.order,
      recent: s.recent,
      label: s.homeBaseLabel,
      awaitingCount: s.awaitingCount,
    })),
  );

  const list = order.map((id) => entries[id]).filter((e): e is PendingEntry => e !== undefined);
  // Read-only rows (40 section 13.5): requests that wait on another computer or in another tab.
  const readOnly =
    role === 'other-device' || role === 'standby'
      ? recent.filter((r) => (r.status === 'claimed' || r.status === 'awaiting-person') && !entries[r.id])
      : [];
  const readOnlyLabel =
    role === 'standby'
      ? REQUESTS.waitingInOtherTab
      : fillText(REQUESTS.waitingOn, { label: label ?? REQUESTS.otherDeviceFallback });
  const selected = selectEntry(list, params.get('id'));
  const hasDone = list.some((e) => e.phase === 'done');
  // The list is hidden when there is exactly one entry and no done entries.
  const showRail = !(list.length === 1 && readOnly.length === 0 && !hasDone);
  const waiting = awaitingCount + readOnly.filter((r) => r.status === 'awaiting-person').length;
  const nothing = list.length === 0 && readOnly.length === 0;

  return (
    <div className={kit.screen}>
      <ScreenHead title={SCREENS.requests.heading} tryNow />
      <RoleBanner onMakeHomeBase={() => setDialogOpen(true)} />
      <GmailTokenBanner />
      <ClickNotice />
      <MemorySaverTip />
      <ShortcutTip />

      <div className={styles.grid}>
        <div className={styles.main}>
          {nothing ? (
            role === 'active' ? (
              <div className={`${kit.glass} ${styles.empty}`}>
                <EmptyState icon="shield" title={REQUESTS.emptyTitle} body={REQUESTS.emptyBody} />
              </div>
            ) : null
          ) : (
            <>
              {showRail ? (
                <PendingList
                  entries={list}
                  readOnly={readOnly}
                  readOnlyLabel={readOnlyLabel}
                  selectedId={selected?.requestId}
                  waitingCount={waiting}
                />
              ) : null}
              {selected ? (
                <ErrorBoundary>
                  <RequestDetail key={selected.requestId} entry={selected} />
                </ErrorBoundary>
              ) : null}
            </>
          )}
        </div>

        <div className={styles.side}>
          <div className={`${kit.glassSm} ${styles.sideCard}`}>
            <h2 className={kit.sectionTitle}>{REQUESTS.howTitle}</h2>
            <p className={kit.small}>{REQUESTS.howBody}</p>
          </div>
          <RecentRequests recent={recent} now={now} />
          <p className={kit.sentence}>{SENTENCE}</p>
        </div>
      </div>

      <MakeHomeBaseDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
