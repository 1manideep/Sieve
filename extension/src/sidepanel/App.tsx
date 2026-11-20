// The side panel (50 section 8.3): header, one main state, the other waiting requests, recent results, footer.
import { useEffect, useState } from 'react';
import type { LadderStep } from '@sieve/shared';
import { rejectionCopy } from '../shared/labels';
import { AlsoWaiting } from './components/AlsoWaiting';
import { VisuallyHidden } from './components/Basics';
import { ConnectingState } from './components/ConnectingState';
import { DisconnectedState } from './components/DisconnectedState';
import { EmptyState } from './components/EmptyState';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Recent } from './components/Recent';
import { RequestCard } from './components/RequestCard';
import { ResultCard } from './components/ResultCard';
import { effectiveStep } from './steps';
import s from './ui.module.css';
import { usePanelPort } from './usePanelPort';
import type { PanelApi } from './usePanelPort';

/** Without any panel/state by then, show the connecting state (50 section 8.1). */
export const CONNECTING_DELAY_MS = 1_500;

const OPENS_APP_ITSELF = new Set(['blocked-never', 'needs-cloud-consent', 'model-unavailable', 'error']);

export function App({ api }: { api: PanelApi }) {
  const { model, send, select, done } = usePanelPort(api);
  const [chosen, setChosen] = useState<Record<string, LadderStep>>({});
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), CONNECTING_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const { state, selectedId, lastRejection, announcement, dismissed } = model;
  const openApp = (requestId?: string) => send({ type: 'panel/open-app', ...(requestId ? { requestId } : {}) });

  const resolvedShown = state ? state.resolved.filter((r) => !dismissed.includes(r.requestId)) : [];
  const selectedResult = resolvedShown.find((r) => r.requestId === selectedId);
  const selectedPreview = selectedResult ? undefined : state?.proposals.find((p) => p.requestId === selectedId);
  const others = state ? state.proposals.filter((p) => p.requestId !== selectedPreview?.requestId) : [];
  const recent = resolvedShown.filter((r) => r.requestId !== selectedResult?.requestId);

  let main: JSX.Element | null;
  let footer = false;
  if (!state) {
    main = waited ? <ConnectingState /> : null;
  } else if (state.connection === 'connecting') {
    main = <ConnectingState />;
  } else if (selectedResult) {
    main = <ResultCard entry={selectedResult} onDone={() => done(selectedResult.requestId)} />;
    footer = true;
  } else if (state.connection === 'disconnected') {
    main = <DisconnectedState onOpenApp={() => openApp()} />;
  } else if (selectedPreview) {
    const id = selectedPreview.requestId;
    const step = effectiveStep(selectedPreview, chosen[id]);
    const rejection = lastRejection?.requestId === id ? rejectionCopy(lastRejection.reason) : null;
    const inflight = state.inflight.find((f) => f.requestId === id);
    main = (
      <RequestCard
        preview={selectedPreview}
        step={step}
        {...(inflight ? { inflight } : {})}
        rejection={rejection}
        onStepChange={(next) => setChosen((c) => ({ ...c, [id]: next }))}
        onApprove={(approvedStep) => send({ type: 'panel/decide', requestId: id, approved: true, step: approvedStep })}
        onDeny={() => send({ type: 'panel/decide', requestId: id, approved: false })}
        onOpenApp={() => openApp(id)}
      />
    );
    footer = !OPENS_APP_ITSELF.has(selectedPreview.outcome);
  } else {
    main = <EmptyState />;
    footer = true;
  }

  const showLists = state !== null && state.connection !== 'connecting';
  return (
    <div className={s.panel}>
      <Header connection={state ? state.connection : waited ? 'connecting' : null} />
      <main className={s.main}>
        {main}
        {showLists && state.connection !== 'disconnected' ? <AlsoWaiting proposals={others} onSelect={select} /> : null}
        {showLists ? <Recent entries={recent} /> : null}
        <div aria-live="polite" aria-atomic="true">
          {announcement ? <VisuallyHidden key={announcement.seq}>{announcement.text}</VisuallyHidden> : null}
        </div>
      </main>
      {footer ? <Footer onOpenApp={() => openApp(selectedPreview?.requestId)} /> : null}
    </div>
  );
}
