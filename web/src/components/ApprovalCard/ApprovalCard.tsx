// ApprovalCard (40 section 16.15): one proposal, in the order the person reads before approving. Used by Ask
// (in-app), Requests (relay) and the Playground. The outgoing text is always composedOptions[step].text, exactly.
// In-app and Playground follow the final design's conversation (F3): the found item as a chip, the answer with the
// ribbon behind it, its mono meta line, then the gate card with the ladder, the exact text, Approve and Keep it here;
// the result, and "What happened" folded at the end. The relay variant keeps its own order (the list column, the
// ladder, the exact text, Approve and Decline).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MAX_PAYLOAD_CHARS, type LadderStep, type Proposal, type StepOption, type TraceStep } from '@sieve/shared';
import type { RecordMeta } from '@/state/records';
import { APPROVAL_COPY, CONVERSATION_COPY, LADDER_COPY, OUTCOME_COPY, OUTGOING_COPY, RELATED_COPY, fill } from '@/copy/screens-main';
import { Glyph } from '../AskResult/glyphs';
import { CategoryBadge } from '../CategoryBadge/CategoryBadge';
import { ConsentPanel } from '../ConsentPanel/ConsentPanel';
import { DecisionBar } from '../DecisionBar/DecisionBar';
import { Icon } from '../icons';
import { ItemSummary } from '../ItemSummary/ItemSummary';
import { LadderControl } from '../LadderControl/LadderControl';
import { draftDiscarded, OutcomePanel } from '../OutcomePanel/OutcomePanel';
import { footerText, OutgoingPreview } from '../OutgoingPreview/OutgoingPreview';
import { RedactedText } from '../RedactedText/RedactedText';
import { RelatedList } from '../RelatedList/RelatedList';
import { formatMs, TraceList } from '../TraceList/TraceList';
import { WarningList } from '../WarningBanner/WarningBanner';
import styles from './ApprovalCard.module.css';

export interface ApprovalCardProps {
  variant: 'in-app' | 'relay' | 'playground';
  proposal: Proposal;
  aiName: string;                              // 'Gemini (in Sieve)' for in-app and Playground
  meta: Record<string, RecordMeta | null>;
  step: LadderStep;
  onStepChange(step: LadderStep): void;
  composedOptions: StepOption[];               // three, from composeOptions()
  relatedSelected: string[];
  relatedLoading: string[];
  relatedErrors?: Record<string, string>;
  onToggleRelated(id: string): void;
  phase: 'open' | 'deciding' | 'decided';
  canApprove: boolean;
  approveBlockedReason?: string;
  onApprove(): void;
  onDeny(): void;
  onAllowCloud(recordId: string): void;
  onOpenItem(recordId: string): void;
  instructionSlot?: ReactNode;                 // in-app and Playground: DraftPanel (before decision)
  resultSlot?: ReactNode;                      // DraftPanel (after) or RelayResult
  extraTrace?: TraceStep[];
  sampleData?: boolean;
  instruction?: string;                        // in-app and Playground: shown under the outgoing text
  onRetry?(): void;                            // outcome 'error'
  headerSlot?: ReactNode;                      // Playground: the 13.2a cloud-while-setting-up tag and "Ask again on this device"
  nanoSettingUp?: boolean;                     // cloud badges read "(sample data; Nano still setting up)"
  consentBusy?: boolean;
}

/** The label of the trace's select step: "Why this one". */
function selectReason(trace: TraceStep[]): string | undefined {
  return trace.find((s) => s.kind === 'select')?.label;
}

/** The mono line under the answer: where it was written, how long it took, and that nothing left (the device case). */
export function answerMetaLine(trace: TraceStep[], sampleData: boolean): string | null {
  const select = trace.find((s) => s.kind === 'select');
  if (!select) return null;
  const t = formatMs(select.ms);
  if (select.where === 'device') return fill(CONVERSATION_COPY.metaDevice, { t });
  if (select.where === 'cloud') return fill(sampleData ? CONVERSATION_COPY.metaCloud : CONVERSATION_COPY.metaCloudOwn, { t });
  return CONVERSATION_COPY.metaCode;
}

export function ApprovalCard(props: ApprovalCardProps) {
  const {
    variant, proposal, aiName, meta, step, onStepChange, composedOptions, relatedSelected, relatedLoading,
    relatedErrors, onToggleRelated, phase, canApprove, approveBlockedReason, onApprove, onDeny, onAllowCloud,
    onOpenItem, instructionSlot, resultSlot, extraTrace = [], sampleData = false, instruction, onRetry, headerSlot,
    nanoSettingUp = false, consentBusy = false,
  } = props;
  const previewId = useId();
  const relatedId = useId();
  const gateId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const focusedResult = useRef(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const relay = variant === 'relay';
  const decided = phase === 'decided';
  const item = proposal.item;
  const trace = [...proposal.trace, ...extraTrace];

  // After a decision, focus moves to the result line once it appears (40 section 14.1).
  useEffect(() => {
    if (!decided) {
      focusedResult.current = false;
      return;
    }
    if (focusedResult.current) return;
    const line = cardRef.current?.querySelector<HTMLElement>('[data-result-line]');
    if (line) {
      focusedResult.current = true;
      line.focus();
    }
  });

  const traceList = (
    <TraceList
      steps={trace}
      sampleData={sampleData}
      neverRule={proposal.outcome === 'blocked-never'}
      nanoSettingUp={nanoSettingUp}
      twoLane
      defaultOpen={relay}
    />
  );

  if (proposal.outcome !== 'ready') {
    return (
      <article ref={cardRef} className={`${styles.card} ${styles[variant]}`} aria-label={APPROVAL_COPY.cardLabel} data-outcome={proposal.outcome}>
        <div className={styles.main}>
          {headerSlot}
          {item ? (
            <ItemSummary
              item={item}
              rule={proposal.rule}
              minimal={proposal.rule === 'never' || proposal.outcome === 'blocked-never'}
              onOpen={proposal.rule === 'never' || relay ? undefined : () => onOpenItem(item.recordId)}
            />
          ) : null}
          {proposal.outcome === 'needs-cloud-consent' && item ? (
            <ConsentPanel
              variant={relay ? 'relay' : variant === 'playground' ? 'playground-upload' : 'own'}
              item={item}
              fullOption={proposal.options[2]}
              busy={consentBusy}
              onAllow={() => onAllowCloud(item.recordId)}
              onDecline={onDeny}
            />
          ) : proposal.outcome !== 'needs-cloud-consent' ? (
            <OutcomePanel
              outcome={proposal.outcome}
              category={item?.category}
              secret={proposal.outcome === 'blocked-never' && proposal.options[0]?.unavailableReason === `${OUTCOME_COPY.secretTitle}.`}
              oneFact={proposal.outcome === 'unsupported' && proposal.options[0]?.unavailableReason === OUTCOME_COPY.oneFactLine}
              discarded={draftDiscarded(proposal)}
              variant={variant === 'playground' ? 'playground' : 'real'}
              onRetry={onRetry}
            />
          ) : null}
          {resultSlot}
          {traceList}
        </div>
      </article>
    );
  }

  const selected = composedOptions.find((o) => o.step === step) ?? composedOptions[0];
  const overLimit = selected.chars > MAX_PAYLOAD_CHARS;
  const answer = proposal.options[0];
  const related = (
    <RelatedList
      variant={relay ? 'list' : 'aside'}
      mainId={relay ? item?.recordId : undefined}
      related={proposal.related}
      meta={meta}
      selected={relatedSelected}
      loading={relatedLoading}
      errors={relatedErrors}
      onToggle={onToggleRelated}
      disabled={decided}
      headingless={variant === 'playground'}
    />
  );

  if (relay) {
    return (
      <article ref={cardRef} className={`${styles.card} ${styles.relay}`} aria-label={APPROVAL_COPY.cardLabel} data-outcome="ready">
        <div className={styles.relayList}>{related}</div>
        <div className={styles.main}>
          {headerSlot}
          <LadderControl
            label={fill(LADDER_COPY.labelRelay, { aiName })}
            options={composedOptions}
            value={step}
            onChange={onStepChange}
            kind={item?.kind}
            requestedStep={proposal.requestedStep}
            aiName={aiName}
            disabled={decided}
            previewId={previewId}
          />
          <OutgoingPreview id={previewId} label={fill(OUTGOING_COPY.labelRelay, { aiName })} option={selected} overLimit={overLimit} hideFooter={!decided} />
          <WarningList warnings={proposal.warnings} category={item?.category} showCleanCheck={proposal.trace.some((s) => s.kind === 'injection')} />
          {!decided ? (
            <p className={styles.askedNote} dir="auto">
              {fill(APPROVAL_COPY.approveOnlyIfAsked, { aiName })}
            </p>
          ) : null}
          {!decided ? (
            <DecisionBar
              variant="relay"
              canApprove={canApprove}
              approveBlockedReason={approveBlockedReason}
              busy={phase === 'deciding' ? 'approve' : undefined}
              onApprove={onApprove}
              onDeny={onDeny}
              chars={selected.chars}
              note={footerText(selected)}
            />
          ) : null}
          {resultSlot}
          {traceList}
        </div>
      </article>
    );
  }

  const chars = selected.chars + (instruction?.length ?? 0);
  const metaLine = answerMetaLine(proposal.trace, sampleData);

  return (
    <article ref={cardRef} className={`${styles.card} ${styles[variant]}`} aria-label={APPROVAL_COPY.cardLabel} data-outcome="ready">
      <div className={styles.main}>
        {item ? null : headerSlot}
        {item ? (
          <>
            <ItemSummary item={item} rule={proposal.rule} onOpen={() => onOpenItem(item.recordId)} />
            {variant === 'playground' ? (
              <div className={styles.ruleLine}>
                <CategoryBadge category={item.category} rule={proposal.rule} mode="rule-line" />
              </div>
            ) : null}
            {answer && answer.available && answer.text !== '' ? (
              <div className={styles.answer}>
                <div className={styles.ribbonLayer} aria-hidden="true">
                  <div className={`ribbon ${styles.ribbon}`} />
                </div>
                <p className={styles.answerText} data-testid="answer-headline">
                  <RedactedText text={answer.text} />
                </p>
              </div>
            ) : null}
            {metaLine ? <p className={styles.metaLine}>{metaLine}</p> : null}
            {selectReason(proposal.trace) ? <span className="visually-hidden">{selectReason(proposal.trace)}</span> : null}
            {/* The Playground's cloud-while-setting-up tag and "Ask again on this device" belong to this answer, and
                they come after the item's heading so the heading levels stay in order. */}
            {headerSlot}
          </>
        ) : null}

        {variant === 'playground' && proposal.related.length > 0 ? (
          <div className={styles.disclosureBlock}>
            <button
              type="button"
              className={styles.disclosure}
              aria-expanded={relatedOpen}
              aria-controls={relatedId}
              onClick={() => setRelatedOpen((v) => !v)}
            >
              <Icon name={relatedOpen ? 'chevron-down' : 'chevron-right'} size={16} />
              {fill(RELATED_COPY.disclosure, { n: proposal.related.length })}
            </button>
            <div id={relatedId} hidden={!relatedOpen}>
              {related}
            </div>
          </div>
        ) : null}

        <section className={`${styles.gate} ${decided ? styles.gateDecided : ''}`} aria-labelledby={gateId}>
          <div className={styles.gateHead}>
            <h3 id={gateId} className={styles.gateTitle}>
              <Glyph name="sparkle" size={14} className={styles.gateGlyph} />
              {CONVERSATION_COPY.gateTitle}
            </h3>
            <LadderControl
              label={LADDER_COPY.labelInApp}
              labelHidden
              options={composedOptions}
              value={step}
              onChange={onStepChange}
              kind={item?.kind}
              aiName={aiName}
              disabled={decided}
              previewId={previewId}
            />
          </div>
          <OutgoingPreview id={previewId} label={OUTGOING_COPY.labelInApp} option={selected} instruction={instruction} overLimit={overLimit} hideFooter />
          {/* The instruction comes before the warnings, so the list sits directly above the buttons and an ask-first
              warning is the last thing read before approving (40 section 16.6). */}
          {!decided ? instructionSlot : null}
          <WarningList warnings={proposal.warnings} category={item?.category} showCleanCheck={proposal.trace.some((s) => s.kind === 'injection')} />
          {!decided ? (
            <DecisionBar
              variant="in-app"
              canApprove={canApprove}
              approveBlockedReason={approveBlockedReason}
              busy={phase === 'deciding' ? 'approve' : undefined}
              onApprove={onApprove}
              onDeny={onDeny}
              chars={chars}
              note={footerText(selected, instruction)}
            />
          ) : (
            <p className={styles.decidedNote}>{footerText(selected, instruction)}</p>
          )}
        </section>

        {resultSlot}
        {variant === 'in-app' ? <div className={styles.related}>{related}</div> : null}
        {/* "What happened, step by step", folded: the gate follows the answer directly, as in F3. */}
        {traceList}
      </div>
    </article>
  );
}
