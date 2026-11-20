// After Approve (board F8B): the rest of the card fades (0.35 s), the approved text lifts out of the panel along a
// dotted Gemini-blue trail (1.1 s), a ring draws and then the green check, and the result rises into place (2 s in).
// About 2.5 s, CSS only, no sound. The card keeps the shape of the request it replaces until the result is in,
// then settles to the receipt's size; it stays until Done. It plays only for a request approved from this panel
// while it was on screen; the App shows the plain ResultCard under prefers-reduced-motion, and the stylesheet also
// turns every keyframe off.
import { useEffect, useId } from 'react';
import { LADDER_STEPS } from '@sieve/shared';
import type { LadderStep, ProposalPreview } from '@sieve/shared';
import type { ResolvedEntry } from '../../shared/internal';
import { COPY, outgoingMeta, requesterName, stepLabel } from '../../shared/labels';
import { isStepEnabled, optionFor } from '../steps';
import s from '../ui.module.css';
import { ItemSummary } from './ItemSummary';
import { CleanLine } from './OutgoingText';
import { ApproveOnlyIfAsked, RequesterLine } from './RequestCard';
import { ResultBody } from './ResultCard';
import type { ResultActions } from './ResultCard';
import { hasInjectionWarning, WarningList } from './WarningList';

export const TRANSITION_TEST_ID = 'approved-transition';
export const LIFTING_TEXT_TEST_ID = 'lifting-text';

/** True when the person asked for less motion; the App then skips the animation. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface ApprovedTransitionProps extends ResultActions {
  entry: ResolvedEntry;
  /** What the card showed when Approve was pressed. */
  preview: ProposalPreview;
  step: LadderStep;
  /** Called on mount and on unmount with the request id, so the App can mark the animation as played exactly once. */
  onStart(requestId: string): void;
  onEnd(requestId: string): void;
}

export function ApprovedTransition({ entry, preview, step, onDone, onOpenReceipt, onStart, onEnd }: ApprovedTransitionProps) {
  const headingId = useId();
  const id = entry.requestId;
  useEffect(() => {
    onStart(id);
    return () => onEnd(id);
  }, [id, onStart, onEnd]);

  const option = optionFor(preview, step);
  const name = requesterName(preview.requester);
  const clean = !hasInjectionWarning(preview.warnings);
  const category = preview.item ? { category: preview.item.category } : {};

  return (
    <article className={`${s.card} ${s.stage}`} aria-labelledby={headingId} data-testid={TRANSITION_TEST_ID}>
      {/* The card as it was, fading; the outgoing box in the middle is the thing that leaves. Once the result is in
          place the row collapses, so the card settles to the receipt's size. */}
      <div className={s.ghostRow} aria-hidden="true">
        <div className={s.ghost}>
          <div className={s.gone}>
            <span className={s.h2}>{COPY.requestHeading}</span>
            <RequesterLine aiName={name} question={preview.question} />
            {preview.item ? <ItemSummary item={preview.item} rule={preview.rule} /> : null}
            <p className={s.label}>{COPY.ladderLabel}</p>
            <div className={s.steps}>
              {LADDER_STEPS.map((st) => (
                <span key={st} className={`${s.step} ${st === step ? s.stepSelected : ''} ${isStepEnabled(preview, st) ? '' : s.stepDisabled}`}>
                  {stepLabel(st)}
                </span>
              ))}
            </div>
            <p className={s.label}>{COPY.outgoingLabel}</p>
          </div>
          <div className={s.liftWrap}>
            <svg className={s.trail} viewBox="0 0 2 520" width="2" height="520" focusable="false">
              <line className={s.trailLine} x1="1" y1="520" x2="1" y2="0" />
            </svg>
            <div className={`${s.outgoingBox} ${s.lift}`} dir="auto" data-testid={LIFTING_TEXT_TEST_ID}>
              {option?.text ?? ''}
            </div>
          </div>
          <div className={s.gone}>
            {option ? (
              <div className={s.metaRow}>
                <span className={s.meta}>{outgoingMeta(option.chars, option.redactions)}</span>
                {clean ? <CleanLine /> : null}
              </div>
            ) : null}
            <WarningList warnings={preview.warnings} {...category} />
            <ApproveOnlyIfAsked aiName={name} />
            <div className={s.actions}>
              <span className={`${s.btnPrimary} ${s.grow} ${s.ghostSending}`}>{COPY.sending}</span>
              <span className={`${s.btnOutline} ${s.ghostDeny}`}>{COPY.deny}</span>
            </div>
            <p className={s.footnote}>{COPY.sourceFootnote}</p>
          </div>
        </div>
      </div>

      {/* What takes its place: the ring, the check, then the result. */}
      <div className={s.pop} aria-hidden="true">
        <svg className={s.mark} width="92" height="92" viewBox="0 0 48 48" focusable="false">
          <circle className={s.ring} cx="24" cy="24" r="22" />
          <path className={s.tick} d="M14 24.5l6.5 6.5L34 17.5" />
        </svg>
      </div>
      <div className={s.rise}>
        <ResultBody
          entry={entry}
          headingId={headingId}
          {...(option ? { sentChars: option.chars } : {})}
          centered
          onDone={onDone}
          onOpenReceipt={onOpenReceipt}
        />
      </div>
    </article>
  );
}
