// The selected request just resolved (50 sections 8.3 and 8.4; boards F8 "Done" and F8B): a glass card with the
// status dot and the title, the body, the mono receipt line, Done and, when a receipt was saved, Open the receipt.
// Shown until the person presses Done. After an approval from this panel the title is "Sent N characters to X"
// (the count is known only here); every other approval keeps "Shared".
import { useId } from 'react';
import type { ResolvedEntry, ResolvedOutcome } from '../../shared/internal';
import { COPY, resultCopy, SENT_HEADING } from '../../shared/labels';
import s from '../ui.module.css';
import { RequesterLine } from './RequestCard';

const DOT: Record<ResolvedOutcome, string | undefined> = {
  approved: s.dotOk,
  declined: s.dotOff,
  expired: s.dotWait,
  error: s.dotOff,
  lost: s.dotWait,
};

export interface ResultActions {
  onDone(): void;
  /** Asks the worker to open the app for this request (panel/open-app with the requestId). */
  onOpenReceipt(): void;
}

interface ResultBodyProps extends ResultActions {
  entry: ResolvedEntry;
  headingId: string;
  /** Characters sent, when this panel approved the request; selects the "Sent N characters to X" heading. */
  sentChars?: number;
  /** The approve animation's layout: centred under the ring, no status dot. */
  centered?: boolean;
}

export function ResultBody({ entry, headingId, sentChars, centered = false, onDone, onOpenReceipt }: ResultBodyProps) {
  const copy = resultCopy(entry);
  const sent = entry.outcome === 'approved' && sentChars !== undefined;
  return (
    <>
      <h2 id={headingId} className={s.resultTitle}>
        {centered ? null : <span className={`${s.dot} ${DOT[entry.outcome] ?? ''}`} aria-hidden="true" />}
        {sent ? (
          <span>
            {SENT_HEADING.before}
            {sentChars.toLocaleString('en-US')}
            {SENT_HEADING.after}
            <bdi>{entry.aiName}</bdi>
          </span>
        ) : (
          copy.heading
        )}
      </h2>
      <RequesterLine aiName={entry.aiName} question={entry.question} />
      <p className={s.body}>{copy.body}</p>
      {copy.tag ? (
        <p className={`${s.receipt} ${copy.tag.tone === 'cloud' ? s.receiptCloud : s.receiptMuted}`}>{copy.tag.text}</p>
      ) : null}
      <div className={s.actions}>
        <button type="button" className={`${s.btnOutline} ${centered ? s.btnWide : s.grow}`} onClick={onDone}>
          {COPY.done}
        </button>
        {copy.tag ? (
          <button type="button" className={`${s.btnOutline} ${centered ? '' : s.grow}`} onClick={onOpenReceipt}>
            {COPY.openReceipt}
          </button>
        ) : null}
      </div>
    </>
  );
}

export function ResultCard({ entry, sentChars, onDone, onOpenReceipt }: { entry: ResolvedEntry; sentChars?: number } & ResultActions) {
  const headingId = useId();
  return (
    <article className={s.card} aria-labelledby={headingId}>
      <ResultBody entry={entry} headingId={headingId} {...(sentChars !== undefined ? { sentChars } : {})} onDone={onDone} onOpenReceipt={onOpenReceipt} />
    </article>
  );
}
