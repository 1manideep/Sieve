// AskResult (40 sections 12.4, 13.4 and 13.9): the result area of Ask and the Playground for one useAsk store.
// PreparingCard while the pipeline runs, then the ApprovalCard in the same container without a layout jump
// (the container keeps its height, then settles over --dur-base), or the error card.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useShallow } from 'zustand/shallow';
import type { AskState } from '@/state/ask';
import { useRecords } from '@/state/records';
import type { DbKind } from '@/state/types';
import { ASK_COPY, RELATED_COPY } from '@/copy/screens-main';
import { askCardView } from '../ApprovalCard/askView';
import { ApprovalCard } from '../ApprovalCard/ApprovalCard';
import type { Compose } from '../ApprovalCard/composedOptions';
import { Button } from '../Button/Button';
import { DraftPanel } from '../DraftPanel/DraftPanel';
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary';
import { ItemViewer } from '../ItemViewer/ItemViewer';
import { PreparingCard } from '../PreparingCard/PreparingCard';
import styles from './AskResult.module.css';

export type AskStore = UseBoundStore<StoreApi<AskState>>;

export interface AskResultProps {
  useAsk: AskStore;
  variant: 'in-app' | 'playground';
  dbKind: DbKind;
  /** The pipeline's composeOutgoingText; loaded with the pipeline when not given (tests inject one). */
  compose?: Compose;
  online: boolean;
  onSeeReceipts(): void;
  onAskAgain(): void;
  idle?: ReactNode;
  headerSlot?: ReactNode;
  sampleData?: boolean;
  nanoSettingUp?: boolean;
}

/** The pipeline's text composer, loaded on first use (the store has already loaded the pipeline by then). */
function useCompose(injected?: Compose): Compose | null {
  const [loaded, setLoaded] = useState<{ compose: Compose } | null>(null);
  useEffect(() => {
    if (injected) return undefined;
    let live = true;
    import('@/pipeline')
      .then((m) => {
        if (live) setLoaded({ compose: m.composeOutgoingText });
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      live = false;
    };
  }, [injected]);
  return injected ?? loaded?.compose ?? null;
}

function PreparingSlot({ useAsk }: { useAsk: AskStore }) {
  const [mountedAt] = useState(() => Date.now());
  const { liveSteps, answerPreview, startedAt } = useAsk(
    useShallow((s) => ({ liveSteps: s.liveSteps, answerPreview: s.answerPreview, startedAt: s.startedAt })),
  );
  return (
    <PreparingCard
      liveSteps={liveSteps}
      answerPreview={answerPreview}
      startedAt={startedAt ?? liveSteps[0]?.startedAt ?? mountedAt}
      onStop={() => useAsk.getState().stop()}
      progressSupported
    />
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry(): void }) {
  const timeout = message === ASK_COPY.timeoutError;
  return (
    <section className={styles.errorCard} aria-labelledby="ask-error-title">
      <h2 id="ask-error-title" className={styles.errorTitle}>
        {timeout ? ASK_COPY.timeoutTitle : ASK_COPY.errorTitle}
      </h2>
      <p className={styles.errorBody}>{message}</p>
      <div>
        <Button variant="secondary" onClick={onRetry}>
          {ASK_COPY.retry}
        </Button>
      </div>
    </section>
  );
}

/** Keeps the container's height across the switch from PreparingCard to ApprovalCard, then lets it settle. */
function useSettle(phase: AskState['phase']) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  const lastPhase = useRef(phase);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    if (lastPhase.current === 'preparing' && phase !== 'preparing' && lastHeight.current > 0) {
      el.style.minHeight = `${lastHeight.current}px`;
      frame = requestAnimationFrame(() => {
        el.style.minHeight = '0px';
      });
    }
    lastPhase.current = phase;
    lastHeight.current = el.offsetHeight;
    return () => cancelAnimationFrame(frame);
  });
  return ref;
}

export function AskResult(props: AskResultProps) {
  const { useAsk, variant, dbKind, compose: injectedCompose, online, onSeeReceipts, onAskAgain, idle, headerSlot, sampleData = false, nanoSettingUp = false } = props;
  const s = useAsk(
    useShallow((st) => ({
      phase: st.phase,
      requestId: st.requestId,
      proposal: st.proposal,
      step: st.step,
      relatedSelected: st.relatedSelected,
      relatedOptions: st.relatedOptions,
      relatedLoading: st.relatedLoading,
      relatedFailed: st.relatedFailed,
      instruction: st.instruction,
      extraTrace: st.extraTrace,
      draft: st.draft,
      outcome: st.outcome,
      draftError: st.draftError,
      error: st.error,
    })),
  );
  const meta = useRecords((r) => r.meta);
  const [viewing, setViewing] = useState<string | null>(null);
  const containerRef = useSettle(s.phase);

  // Titles of related items for the list (ids only; no content kept).
  const relatedIds = s.proposal?.related.map((c) => c.recordId).join('|') ?? '';
  useEffect(() => {
    if (!relatedIds) return;
    useRecords.getState().ensure(dbKind, relatedIds.split('|')).catch((error: unknown) => console.error(error));
  }, [dbKind, relatedIds]);

  const compose = useCompose(injectedCompose);
  const view = compose ? askCardView(s, { online, compose }) : null;
  const ask = () => {
    useAsk.getState().ask().catch((error: unknown) => console.error(error));
  };

  let content: ReactNode = idle ?? null;
  if (s.phase === 'preparing') {
    content = <PreparingSlot key={s.requestId ?? 'preparing'} useAsk={useAsk} />;
  } else if (s.phase === 'error') {
    content = <ErrorCard message={s.error ?? ASK_COPY.errorTitle} onRetry={ask} />;
  } else if (s.proposal && view) {
    const draftPanel = (
      <DraftPanel
        instruction={s.instruction}
        onInstructionChange={(t) => useAsk.getState().setInstruction(t)}
        phase={s.phase}
        draft={s.draft}
        draftError={s.draftError}
        onRetry={() => {
          useAsk.getState().retryDraft().catch((error: unknown) => console.error(error));
        }}
        outcome={s.outcome}
        stepPhrase={view.stepPhrase}
        onSeeReceipts={onSeeReceipts}
        onAskAgain={onAskAgain}
      />
    );
    content = (
      <ApprovalCard
        key={s.requestId}
        variant={variant}
        proposal={s.proposal}
        aiName={s.proposal.requester.aiName}
        meta={meta}
        step={s.step}
        onStepChange={(step) => useAsk.getState().setStep(step)}
        composedOptions={view.composed}
        relatedSelected={s.relatedSelected}
        relatedLoading={s.relatedLoading}
        relatedErrors={Object.fromEntries((s.relatedFailed ?? []).map((id) => [id, RELATED_COPY.error]))}
        onToggleRelated={(id) => {
          useAsk.getState().toggleRelated(id).catch((error: unknown) => console.error(error));
        }}
        phase={view.cardPhase}
        canApprove={view.canApprove}
        approveBlockedReason={view.approveBlockedReason}
        onApprove={() => {
          useAsk.getState().approveAndDraft().catch((error: unknown) => console.error(error));
        }}
        onDeny={() => {
          if (s.proposal?.outcome === 'needs-cloud-consent') useAsk.getState().reset();
          else useAsk.getState().keepLocal();
        }}
        onAllowCloud={(id) => {
          useAsk.getState().allowCloudFor(id).catch((error: unknown) => console.error(error));
        }}
        onOpenItem={setViewing}
        instructionSlot={draftPanel}
        resultSlot={view.cardPhase === 'decided' ? draftPanel : undefined}
        extraTrace={s.extraTrace}
        sampleData={sampleData}
        instruction={s.instruction}
        onRetry={ask}
        headerSlot={headerSlot}
        nanoSettingUp={nanoSettingUp}
      />
    );
  }

  return (
    <div ref={containerRef} className={styles.container} data-phase={s.phase}>
      <ErrorBoundary onReset={() => useAsk.getState().reset()}>{content}</ErrorBoundary>
      <ItemViewer dbKind={dbKind} recordId={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
