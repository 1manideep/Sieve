// AskResult (40 sections 12.4, 13.4 and 13.9): the result area of Ask and the Playground for one useAsk store, as the
// final design's conversation (F3): the question as a bubble, "Searched N items on this computer · picked 1", then the
// PreparingCard while the pipeline runs, the ApprovalCard in the same container without a layout jump (the container
// keeps its height, then settles over --dur-base), or the error card.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useShallow } from 'zustand/shallow';
import type { TraceStep } from '@sieve/shared';
import type { AskState } from '@/state/ask';
import { useRecords } from '@/state/records';
import type { DbKind } from '@/state/types';
import { formatCount } from '@/copy/format';
import { ASK_COPY, CONVERSATION_COPY, RELATED_COPY, fill } from '@/copy/screens-main';
import { askCardView } from '../ApprovalCard/askView';
import { ApprovalCard } from '../ApprovalCard/ApprovalCard';
import type { Compose } from '../ApprovalCard/composedOptions';
import { Button } from '../Button/Button';
import { tablesOf, useDb } from '../dbTables';
import { DraftPanel } from '../DraftPanel/DraftPanel';
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary';
import { ItemViewer } from '../ItemViewer/ItemViewer';
import { PreparingCard } from '../PreparingCard/PreparingCard';
import { Glyph } from './glyphs';
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
  /** Real data: the receipt chip's "open" is a link to this page (the Playground switches its tab instead). */
  receiptsHref?: string;
  onAskAgain(): void;
  idle?: ReactNode;
  headerSlot?: ReactNode;
  sampleData?: boolean;
  nanoSettingUp?: boolean;
  /**
   * The Ask page (Nov 22, 2026): a prepared answer shows as a plain chat reply with Copy, Open the item and Details
   * under it; the card with the steps, the ladder and what may leave opens from Details.
   */
  chat?: boolean;
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

/** How many items the index holds (the "Searched N items" line); undefined until the database answers. */
function useIndexCount(dbKind: DbKind, enabled: boolean): number | undefined {
  const db = useDb(dbKind, enabled);
  return useLiveQuery(async () => {
    if (!db) return undefined;
    const records = tablesOf(db).records as { count?: () => Promise<number> } | undefined;
    if (typeof records?.count !== 'function') return undefined;
    try {
      return await records.count();
    } catch {
      return undefined;
    }
  }, [db]);
}

/**
 * How many items a model read: the likely matches of the search step ("Found 3 likely matches on this device…"). The
 * reading step reads those and nothing else, so every other item in the index was never read by a model.
 */
export function likelyMatches(trace: readonly TraceStep[]): number | undefined {
  for (const step of trace) {
    if (step.kind !== 'retrieve') continue;
    const found = /^Found (\d+) likely match/.exec(step.label);
    if (found) return Number(found[1]);
  }
  return undefined;
}

/** "Searched 46 items on this computer · picked 1 · the other 45 were never read by a model" (real numbers only). */
export function searchedLine(count: number | undefined, read?: number): string {
  if (count === undefined) return CONVERSATION_COPY.searchedUnknown;
  const n = formatCount(count);
  const rest = read === undefined ? 0 : count - read;
  if (read === undefined || read < 1 || rest < 1) return fill(CONVERSATION_COPY.searched, { n });
  if (read === 1) return rest === 1 ? fill(CONVERSATION_COPY.searchedOtherOne, { n }) : fill(CONVERSATION_COPY.searchedOthers, { n, rest: formatCount(rest) });
  return rest === 1 ? fill(CONVERSATION_COPY.searchedRestOne, { n }) : fill(CONVERSATION_COPY.searchedRest, { n, rest: formatCount(rest) });
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

/** Chat: while the answer is prepared, one quiet line, or the answer as it is being written. */
function ChatPreparing({ useAsk }: { useAsk: AskStore }) {
  const { liveSteps, answerPreview } = useAsk(useShallow((s) => ({ liveSteps: s.liveSteps, answerPreview: s.answerPreview })));
  return (
    <div className={styles.reply} role="status">
      {answerPreview ? (
        <p className={styles.replyText} dir="auto">{answerPreview}</p>
      ) : (
        <p className={styles.searched}>
          <Glyph name="sparkle" size={16} className={styles.sparkle} />
          <span>{liveSteps[liveSteps.length - 1]?.label ?? CONVERSATION_COPY.looking}</span>
        </p>
      )}
    </div>
  );
}

function ChatReply({ text, open, onToggle, onOpenItem }: { text: string; open: boolean; onToggle(): void; onOpenItem?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.reply}>
      <p className={styles.replyText} dir="auto">{text}</p>
      <div className={styles.replyActions}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
          }}
        >
          {copied ? CONVERSATION_COPY.copied : CONVERSATION_COPY.copy}
        </Button>
        {onOpenItem ? (
          <Button variant="ghost" size="sm" onClick={onOpenItem}>
            {CONVERSATION_COPY.openItem}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={onToggle}>
          {open ? CONVERSATION_COPY.hideDetails : CONVERSATION_COPY.details}
        </Button>
      </div>
    </div>
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

/** The question as it was asked, kept for the bubble while the field below is edited (state kept per request). */
function useAskedQuestion(useAsk: AskStore): string {
  const { requestId, question, proposal } = useAsk(useShallow((s) => ({ requestId: s.requestId, question: s.question, proposal: s.proposal })));
  const [asked, setAsked] = useState<{ requestId?: string; text: string }>({ requestId, text: question });
  if (asked.requestId !== requestId) setAsked({ requestId, text: proposal?.question ?? question });
  return proposal?.question ?? (asked.requestId === requestId ? asked.text : question);
}

export function AskResult(props: AskResultProps) {
  const { useAsk, variant, dbKind, compose: injectedCompose, online, onSeeReceipts, receiptsHref, onAskAgain, idle, headerSlot, sampleData = false, nanoSettingUp = false, chat = false } = props;
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
  /** Chat: the request whose details are open (closed again for the next question). */
  const [detailsFor, setDetailsFor] = useState<string | undefined>(undefined);
  const containerRef = useSettle(s.phase);
  const asked = useAskedQuestion(useAsk);
  const indexCount = useIndexCount(dbKind, s.proposal !== undefined);
  const bubbleRef = useRef<HTMLParagraphElement>(null);
  const startedFor = useRef<string | undefined>(undefined);

  // The first question replaces the prompt card (F2 becomes F3), so the field or chip that had focus is gone. Focus
  // then starts the conversation at the question bubble, once per request; a follow-up keeps focus in its own field.
  useEffect(() => {
    if (s.phase === 'idle') return;
    const key = s.requestId ?? s.phase;
    if (startedFor.current === key) return;
    startedFor.current = key;
    const active = document.activeElement;
    if (active === null || active === document.body) bubbleRef.current?.focus();
  }, [s.phase, s.requestId]);

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

  // Chat: a prepared answer that waits for nothing is shown as a plain reply. Anything that needs the person (a
  // consent, a draft under way, a result after approving) or has no answer keeps the card in view.
  const chatOption =
    chat && s.phase === 'ready' && s.proposal?.outcome === 'ready'
      ? (s.proposal.options.find((o) => o.step === s.step && o.available) ?? s.proposal.options.find((o) => o.available))
      : undefined;
  const chatText = chatOption?.text.trim() ? chatOption.text : undefined;
  const detailsOpen = chatText === undefined || detailsFor === s.requestId;

  let content: ReactNode = idle ?? null;
  if (s.phase === 'preparing') {
    content = chat ? <ChatPreparing useAsk={useAsk} /> : <PreparingSlot key={s.requestId ?? 'preparing'} useAsk={useAsk} />;
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
        receiptsHref={receiptsHref}
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

  const conversation = s.phase !== 'idle';
  // A ticked related item is prepared on this device too, so it counts as read (the number stays a true lower bound).
  const matches = likelyMatches(s.proposal?.trace ?? []);
  const readCount = matches === undefined ? undefined : matches + s.relatedSelected.length;
  const picked = s.proposal?.outcome === 'ready' && s.proposal.item !== undefined;

  return (
    <div ref={containerRef} className={styles.container} data-phase={s.phase}>
      {conversation && asked ? (
        <div className={styles.bubbleRow}>
          <p ref={bubbleRef} className={styles.bubble} dir="auto" tabIndex={-1}>
            <span className="visually-hidden">{CONVERSATION_COPY.you} </span>
            {asked}
          </p>
        </div>
      ) : null}
      {chatText !== undefined ? (
        <ChatReply
          text={chatText}
          open={detailsOpen}
          onToggle={() => setDetailsFor(detailsOpen ? undefined : s.requestId)}
          onOpenItem={s.proposal?.item ? () => setViewing(s.proposal?.item?.recordId ?? null) : undefined}
        />
      ) : null}
      {picked && detailsOpen ? (
        <p className={styles.searched}>
          <Glyph name="sparkle" size={16} className={styles.sparkle} />
          <span>{searchedLine(indexCount, readCount)}</span>
        </p>
      ) : null}
      <ErrorBoundary onReset={() => useAsk.getState().reset()}>{detailsOpen || s.phase === 'preparing' ? content : null}</ErrorBoundary>
      <ItemViewer dbKind={dbKind} recordId={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
