// Requests (40 section 13.5; docs/design/final-flow.md F11 since Nov 20): two panes. Left, every request in one
// searchable list with the waiting ones pinned on top. Right, the selected request: the approval card for a waiting
// one, or the outcome and the way to its receipt for a finished one. The notices stay above both.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { REQUESTS, SENTENCE, fillText } from '@/copy/screens-controls';
import { SCREENS, TITLES } from '@/copy/strings';
import { useHomeBase, type PendingEntry } from '@/state/homeBase';
import ground from '../settings/kit/ground.module.css';
import kit from '../settings/kit/kit.module.css';
import { MakeHomeBaseDialog } from '../settings/kit/MakeHomeBaseDialog';
import { ScreenHead } from '../settings/kit/ScreenHead';
import { HistoryDetail } from './HistoryDetail';
import { RequestDetail } from './RequestDetail';
import { RequestList } from './RequestList';
import { AutoApproveNotice, ClickNotice, MemorySaverTip, RoleBanner, ShortcutTip } from './RequestNotices';
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
  const { role, entries, order, recent, label } = useHomeBase(
    useShallow((s) => ({ role: s.role, entries: s.entries, order: s.order, recent: s.recent, label: s.homeBaseLabel })),
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
  const id = params.get('id');
  const selectedEntry = selectEntry(list, id);
  // A history row selected by ?id= (not a live entry) shows its outcome instead.
  const selectedHistory = !list.some((e) => e.requestId === id) ? recent.find((r) => r.id === id) : undefined;
  const selectedId = selectedHistory?.id ?? selectedEntry?.requestId;

  return (
    <div className={kit.screen}>
      <ScreenHead
        title={SCREENS.requests.heading}
        tryNow
        actions={
          role === 'active' || role === 'standby' || role === 'other-device' ? (
            <span className={`${ground.pill} ${role === 'active' ? ground.pillOk : ''}`}>
              <span className={ground.pillDot} aria-hidden="true" />
              {role === 'other-device' ? fillText(REQUESTS.homeBaseOn, { label: label ?? REQUESTS.otherDeviceFallback }) : REQUESTS.homeBaseHere}
            </span>
          ) : undefined
        }
      />
      <RoleBanner onMakeHomeBase={() => setDialogOpen(true)} />
      <AutoApproveNotice />
      <ClickNotice />
      <MemorySaverTip />
      <ShortcutTip />

      <div className={styles.panes}>
        <RequestList entries={list} recent={recent} readOnly={readOnly} readOnlyLabel={readOnlyLabel} selectedId={selectedId} now={now} />
        <section className={styles.detailPane} aria-label={REQUESTS.selectedLabel}>
          {selectedHistory ? (
            <HistoryDetail request={selectedHistory} now={now} />
          ) : selectedEntry ? (
            <ErrorBoundary>
              <RequestDetail key={selectedEntry.requestId} entry={selectedEntry} />
            </ErrorBoundary>
          ) : (
            <div className={styles.sideCard}>
              <h2 className={kit.sectionTitle}>{list.length === 0 && recent.length === 0 ? REQUESTS.noneWaitingTitle : REQUESTS.howTitle}</h2>
              <p className={kit.small}>{REQUESTS.howBody}</p>
              <p className={kit.note}>{REQUESTS.pickOne}</p>
            </div>
          )}
          <p className={kit.sentence}>{SENTENCE}</p>
        </section>
      </div>

      <MakeHomeBaseDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
