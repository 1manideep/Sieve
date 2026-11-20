// ApprovalCard (40 section 16.15): one proposal, in the order the person reads before approving. Used by Ask
// (in-app), Requests (relay) and the Playground. The outgoing text is always composedOptions[step].text, exactly.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MAX_PAYLOAD_CHARS, type LadderStep, type Proposal, type StepOption, type TraceStep } from '@sieve/shared';
import type { RecordMeta } from '@/state/records';
import { APPROVAL_COPY, LADDER_COPY, OUTGOING_COPY, RELATED_COPY, fill } from '@/copy/screens-main';
import { CategoryBadge } from '../CategoryBadge/CategoryBadge';
import { ConsentPanel } from '../ConsentPanel/ConsentPanel';
import { DecisionBar } from '../DecisionBar/DecisionBar';
import { Icon } from '../icons';
import { ItemSummary } from '../ItemSummary/ItemSummary';
import { LadderControl } from '../LadderControl/LadderControl';
import { OutcomePanel } from '../OutcomePanel/OutcomePanel';
import { OutgoingPreview } from '../OutgoingPreview/OutgoingPreview';
import { RedactedText } from '../RedactedText/RedactedText';
import { RelatedList } from '../RelatedList/RelatedList';
import { TraceList } from '../TraceList/TraceList';
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

export function ApprovalCard(props: ApprovalCardProps) {
  const {
    variant, proposal, aiName, meta, step, onStepChange, composedOptions, relatedSelected, relatedLoading,
    relatedErrors, onToggleRelated, phase, canApprove, approveBlockedReason, onApprove, onDeny, onAllowCloud,
    onOpenItem, instructionSlot, resultSlot, extraTrace = [], sampleData = false, instruction, onRetry, headerSlot,
    nanoSettingUp = false, consentBusy = false,
  } = props;
  const previewId = useId();
  const relatedId = useId();
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
    />
  );

  if (proposal.outcome !== 'ready') {
    return (
      <article ref={cardRef} className={styles.card} aria-label={APPROVAL_COPY.cardLabel} data-outcome={proposal.outcome}>
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

  return (
    <article ref={cardRef} className={`${styles.card} ${styles[variant]}`} aria-label={APPROVAL_COPY.cardLabel} data-outcome="ready">
      {relay ? <div className={styles.relayList}>{related}</div> : null}
      <div className={styles.main}>
        {headerSlot}
        {!relay && item ? (
          <>
            {variant === 'playground' ? (
              <div>
                <CategoryBadge category={item.category} rule={proposal.rule} mode="rule-line" />
              </div>
            ) : null}
            <ItemSummary item={item} rule={proposal.rule} reason={selectReason(proposal.trace)} onOpen={() => onOpenItem(item.recordId)} />
            {answer && answer.available && answer.text !== '' ? (
              <div className={styles.answer}>
                <p className={styles.eyebrow}>{APPROVAL_COPY.answerEyebrow}</p>
                <p className={styles.answerText} data-testid="answer-headline">
                  <RedactedText text={answer.text} />
                </p>
              </div>
            ) : null}
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

        <LadderControl
          label={relay ? fill(LADDER_COPY.labelRelay, { aiName }) : LADDER_COPY.labelInApp}
          options={composedOptions}
          value={step}
          onChange={onStepChange}
          kind={item?.kind}
          requestedStep={relay ? proposal.requestedStep : undefined}
          aiName={aiName}
          disabled={decided}
          previewId={previewId}
        />
        <OutgoingPreview
          id={previewId}
          label={relay ? fill(OUTGOING_COPY.labelRelay, { aiName }) : OUTGOING_COPY.labelInApp}
          option={selected}
          instruction={relay ? undefined : instruction}
          overLimit={overLimit}
        />
        {/* The instruction comes before the warnings, so the list sits directly above the buttons and an ask-first
            warning is the last thing read before approving (40 section 16.6). */}
        {!decided && !relay ? instructionSlot : null}
        <WarningList warnings={proposal.warnings} category={item?.category} showCleanCheck={proposal.trace.some((s) => s.kind === 'injection')} />
        {!decided && relay ? <p dir="auto">{fill(APPROVAL_COPY.approveOnlyIfAsked, { aiName })}</p> : null}
        {!decided ? (
          <DecisionBar
            variant={relay ? 'relay' : 'in-app'}
            canApprove={canApprove}
            approveBlockedReason={approveBlockedReason}
            busy={phase === 'deciding' ? 'approve' : undefined}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ) : null}
        {resultSlot}
        {traceList}
      </div>
      {variant === 'in-app' ? <aside className={styles.aside}>{related}</aside> : null}
    </article>
  );
}
