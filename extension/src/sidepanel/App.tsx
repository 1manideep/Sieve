// The panel (50 section 8.3; boards F7, F8, F8B): header, one main state, the other waiting requests, footer. The
// header's gear shows the settings block under it (50 section 8.10) when the page has a settings store. Since Nov 23
// it also shows the requests the home base is still preparing (one card when nothing waits, a list otherwise), a line
// when Gmail access on that computer ran out, and Try again on a decision that could not be sent.
// Resolved requests show only while selected (the one just decided); there is no list of recent results.
// The same page is the toolbar popup (400 px wide, as tall as its content up to Chrome's 600 px cap, the main area
// scrolling after that) and the side panel. A popup closes when it loses focus: decisions are sent at once, the
// approve animation is only a picture, and a popup that opens again shows the plain result card.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { LadderStep, ProposalPreview } from '@sieve/shared';
import { rejectionCopy } from '../shared/labels';
import { AlsoWaiting } from './components/AlsoWaiting';
import { ApprovedTransition, prefersReducedMotion } from './components/ApprovedTransition';
import { VisuallyHidden } from './components/Basics';
import { ConnectingState } from './components/ConnectingState';
import { DisconnectedState } from './components/DisconnectedState';
import { EmptyState } from './components/EmptyState';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { BeingPrepared, GmailEnded, PreparingCard } from './components/Preparing';
import { RequestCard } from './components/RequestCard';
import { ResultCard } from './components/ResultCard';
import { SettingsMenu } from './components/SettingsMenu';
import { effectiveStep, optionFor } from './steps';
import s from './ui.module.css';
import { usePanelPort } from './usePanelPort';
import type { PanelApi } from './usePanelPort';

/** Without any panel/state by then, show the connecting state (50 section 8.1). */
export const CONNECTING_DELAY_MS = 1_500;

const OPENS_APP_ITSELF = new Set(['blocked-never', 'needs-cloud-consent', 'model-unavailable', 'error']);

interface ApprovedHere {
  requestId: string;
  preview: ProposalPreview;
  step: LadderStep;
}

export function App({ api }: { api: PanelApi }) {
  const { model, send, select, done, retry } = usePanelPort(api);
  const [chosen, setChosen] = useState<Record<string, LadderStep>>({});
  const [waited, setWaited] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  const gearRef = useRef<HTMLButtonElement>(null);
  // The request approved from this panel, with what the card showed, so the approve animation can lift the exact
  // text (board F8B). Approving locks the card, so at most one is ever in flight from here.
  const [approvedHere, setApprovedHere] = useState<ApprovedHere | null>(null);
  // Ids whose animation has already played (the transition unmounted), keyed by request id: a re-render keeps the
  // mounted transition as it is, and a remount shows the plain result instead of replaying it.
  const [played, setPlayed] = useState<ReadonlySet<string>>(() => new Set());
  const onTransitionStart = useCallback((id: string) => {
    setPlayed((p) => {
      if (!p.has(id)) return p;
      const next = new Set(p);
      next.delete(id);
      return next;
    });
  }, []);
  const onTransitionEnd = useCallback((id: string) => {
    setPlayed((p) => (p.has(id) ? p : new Set(p).add(id)));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), CONNECTING_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const { state, selectedId, lastRejection, announcement, dismissed } = model;
  const surface = api.surface ?? 'panel';
  const openApp = (requestId?: string) => send({ type: 'panel/open-app', ...(requestId ? { requestId } : {}) });
  // "Keep open on the side": the popup opens the side panel itself (inside the click), then closes. If Chrome
  // refuses, the worker tries, and closes the popup only when the side panel opened.
  const openSidePanel = api.openSidePanel;
  const keepOpen =
    surface === 'popup' && openSidePanel
      ? () => {
          openSidePanel().then(
            () => api.closePanel(),
            () => send({ type: 'panel/open-side' }),
          );
        }
      : undefined;

  const resolvedShown = state ? state.resolved.filter((r) => !dismissed.includes(r.requestId)) : [];
  const selectedResult = resolvedShown.find((r) => r.requestId === selectedId);
  const selectedPreview = selectedResult ? undefined : state?.proposals.find((p) => p.requestId === selectedId);
  const others = state ? state.proposals.filter((p) => p.requestId !== selectedPreview?.requestId) : [];
  const preparing = state?.preparing ?? [];
  // Nothing waits for the person: the oldest request being prepared is the main card.
  const preparingShown = state && !selectedResult && !selectedPreview && state.connection !== 'disconnected' ? preparing[0] : undefined;

  let main: JSX.Element | null;
  let footer = false;
  if (!state) {
    main = waited ? <ConnectingState /> : null;
  } else if (state.connection === 'connecting') {
    main = <ConnectingState />;
  } else if (selectedResult) {
    const id = selectedResult.requestId;
    // This panel approved it: the count it sent is known, and the animation plays once.
    const here = selectedResult.outcome === 'approved' && approvedHere !== null && approvedHere.requestId === id ? approvedHere : null;
    const sentChars = here ? optionFor(here.preview, here.step)?.chars : undefined;
    const animate = here !== null && !played.has(id) && !prefersReducedMotion() ? here : null;
    // The page could not send it and the request still waits: Try again shows it once more.
    const stillWaiting = selectedResult.outcome === 'error' && state.proposals.some((p) => p.requestId === id);
    const actions = { onDone: () => done(id), onOpenReceipt: () => openApp(id), ...(stillWaiting ? { onRetry: () => retry(id) } : {}) };
    main = animate ? (
      <ApprovedTransition key={id} entry={selectedResult} preview={animate.preview} step={animate.step} onStart={onTransitionStart} onEnd={onTransitionEnd} {...actions} />
    ) : (
      <ResultCard entry={selectedResult} {...(sentChars !== undefined ? { sentChars } : {})} {...actions} />
    );
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
        onApprove={(approvedStep) => {
          setApprovedHere({ requestId: id, preview: selectedPreview, step: approvedStep });
          // The hash of the text on screen goes with the approval, so a text that changed meanwhile is refused.
          const { textHash } = selectedPreview;
          send({ type: 'panel/decide', requestId: id, approved: true, step: approvedStep, ...(textHash !== undefined ? { textHash } : {}) });
        }}
        onDeny={() => send({ type: 'panel/decide', requestId: id, approved: false })}
        onOpenApp={() => openApp(id)}
      />
    );
    footer = !OPENS_APP_ITSELF.has(selectedPreview.outcome);
  } else if (preparingShown) {
    main = <PreparingCard key={preparingShown.requestId} item={preparingShown} onOpenApp={() => openApp(preparingShown.requestId)} />;
    footer = true;
  } else {
    main = <EmptyState />;
    footer = true;
  }

  const showLists = state !== null && state.connection !== 'connecting' && state.connection !== 'disconnected';
  const settingsStore = api.settings;
  const closeSettings = () => {
    setSettingsOpen(false);
    gearRef.current?.focus();
  };
  return (
    <div className={`${s.panel} ${surface === 'popup' ? s.popup : ''}`} data-surface={surface}>
      <Header
        connection={state ? state.connection : waited ? 'connecting' : null}
        onClose={() => api.closePanel()}
        {...(settingsStore ? { settings: { open: settingsOpen, controls: settingsId, onToggle: () => setSettingsOpen((o) => !o) }, gearRef } : {})}
      />
      {settingsStore ? <SettingsMenu id={settingsId} open={settingsOpen} store={settingsStore} onClose={closeSettings} /> : null}
      <main className={s.main}>
        {showLists && state.gmail === 'ended' ? <GmailEnded onOpenApp={() => openApp()} /> : null}
        {main}
        {showLists ? <AlsoWaiting proposals={others} onSelect={select} /> : null}
        {showLists ? <BeingPrepared items={preparing.filter((p) => p !== preparingShown)} onOpen={(id) => openApp(id)} /> : null}
        <div aria-live="polite" aria-atomic="true">
          {announcement ? <VisuallyHidden key={announcement.seq}>{announcement.text}</VisuallyHidden> : null}
        </div>
      </main>
      {footer ? <Footer onOpenApp={() => openApp(selectedPreview?.requestId)} {...(keepOpen ? { onKeepOpen: keepOpen } : {})} /> : null}
    </div>
  );
}
