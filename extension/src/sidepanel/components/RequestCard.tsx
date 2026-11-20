// The selected waiting request (50 sections 8.3 to 8.5). Which actions show depends on the outcome:
// ready: Approve + Deny; no-match: Deny only; every other outcome: Open Sieve only. Related items are never
// offered here; ticking them is done in the app.
import { useId } from 'react';
import type { Category, LadderStep, ProposalOutcome, ProposalPreview } from '@sieve/shared';
import type { InflightEntry } from '../../shared/internal';
import { APPROVE_ONLY_IF_ASKED, COPY, outcomeCopy, requesterName } from '../../shared/labels';
import { optionFor } from '../steps';
import s from '../ui.module.css';
import { DecisionButtons } from './DecisionButtons';
import { ItemSummary } from './ItemSummary';
import { OutgoingText } from './OutgoingText';
import { StepPicker } from './StepPicker';
import { WarningList } from './WarningList';

interface RequestCardProps {
  preview: ProposalPreview;
  step: LadderStep | null;
  inflight?: InflightEntry;
  rejection: string | null;
  onStepChange(step: LadderStep): void;
  onApprove(step: LadderStep): void;
  onDeny(): void;
  onOpenApp(): void;
}

/** `{aiName} asked for: "{question}"`, the question always in body text, never a heading or tag (70 R-UI-06). */
export function RequesterLine({ aiName, question }: { aiName: string; question: string }) {
  return (
    <p className={s.requester}>
      <bdi>{aiName}</bdi> asked for: <span className={s.quote} dir="auto">{`"${question}"`}</span>
    </p>
  );
}

export function RequestCard({ preview, step, inflight, rejection, onStepChange, onApprove, onDeny, onOpenApp }: RequestCardProps) {
  const headingId = useId();
  const busy = inflight !== undefined && !inflight.slow;
  const option = step !== null ? optionFor(preview, step) : undefined;
  const { outcome } = preview;

  return (
    <article className={s.card} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.h2}>
        {COPY.requestHeading}
      </h2>
      <RequesterLine aiName={requesterName(preview.requester)} question={preview.question} />
      {preview.item ? <ItemSummary item={preview.item} rule={preview.rule} /> : null}

      {outcome === 'ready' ? (
        <>
          <StepPicker preview={preview} value={step} locked={busy} onChange={onStepChange} />
          {option ? <OutgoingText option={option} /> : null}
          <WarningList warnings={preview.warnings} {...(preview.item ? { category: preview.item.category } : {})} />
        </>
      ) : (
        <OutcomeBlock outcome={outcome} {...(preview.item ? { category: preview.item.category } : {})} />
      )}

      {rejection ? (
        <p className={s.alert} role="alert">
          {rejection}
        </p>
      ) : null}
      {inflight?.slow ? <p className={s.note}>{COPY.slowNote}</p> : null}
      {outcome === 'ready' ? (
        <p className={s.body}>
          {APPROVE_ONLY_IF_ASKED.before}
          <bdi>{requesterName(preview.requester)}</bdi>
          {APPROVE_ONLY_IF_ASKED.after}
        </p>
      ) : null}

      {outcome === 'ready' || outcome === 'no-match' ? (
        <DecisionButtons
          showApprove={outcome === 'ready'}
          canApprove={option !== undefined && step !== null}
          {...(inflight ? { inflight } : {})}
          onApprove={() => {
            if (step !== null) onApprove(step);
          }}
          onDeny={onDeny}
        />
      ) : (
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={onOpenApp}>
            {COPY.openSieve}
          </button>
        </div>
      )}
      <p className={s.footnote}>{COPY.sourceFootnote}</p>
    </article>
  );
}

function OutcomeBlock({ outcome, category }: { outcome: Exclude<ProposalOutcome, 'ready'>; category?: Category }) {
  const copy = outcomeCopy(outcome, category);
  return (
    <section className={`${s.outcome} ${outcome === 'blocked-never' ? s.outcomeNever : ''}`} aria-label={copy.heading}>
      <h3 className={s.h3}>{copy.heading}</h3>
      <p className={s.body}>{copy.body}</p>
    </section>
  );
}
