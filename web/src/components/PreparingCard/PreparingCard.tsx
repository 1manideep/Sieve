// PreparingCard (40 sections 12.4 and 16.8): fills as the pipeline works, so the on-device wait feels purposeful.
// Labels are the pipeline's; the streamed answer is shown, never sent, and never announced token by token. After
// 3 seconds it says how long since the question and what is usual, what happens next (when the caller knows), and why
// it is slow when it is: the model is still being set up, or it runs past a minute (Nov 23, 2026).
import { useId } from 'react';
import { WAITING, WAITING_SLOW_MS, waitTime } from '@sieve/shared';
import { useNow } from '@/app/useNow';
import type { LiveStep } from '@/state/types';
import { PREPARING_COPY, fill } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { Icon } from '../icons';
import { ProgressBar } from '../ProgressBar/ProgressBar';
import { Tag } from '../Tag/Tag';
import { formatMs } from '../TraceList/TraceList';
import styles from './PreparingCard.module.css';

export interface PreparingCardProps {
  liveSteps: LiveStep[];
  answerPreview: string;
  /** When the question was asked: the waiting lines count from here. */
  startedAt: number;
  onStop(): void;
  progressSupported: boolean;     // false when CR-3 onProgress is absent
  /** Replaces "Working on this device", e.g. "Preparing an answer for Claude" on Requests. */
  heading?: string;
  /** What happens once it is ready, e.g. "You'll be asked to approve before anything is sent." */
  next?: string;
  /** The on-device model is still being set up: how far, in percent. */
  setupPct?: number;
}

export const SLOW_LINE_MS = 3000;

/** The reading step reports where it runs; a cloud select or answer turns the tag blue (sample data without Nano). */
export function readsInCloud(steps: LiveStep[]): boolean {
  return steps.some((s) => (s.kind === 'select' || s.kind === 'answer') && (s.step?.where ?? s.where) === 'cloud');
}

/**
 * The waiting lines under a preparation: how long since it was asked (from 3 seconds), what happens next, and why
 * it is slow. Ask's chat shows the same lines under its one-line reply.
 */
export function waitingLines(elapsed: number, o: { next?: string; setupPct?: number; quiet?: boolean }): string[] {
  if (elapsed < SLOW_LINE_MS) return [];
  const lines = [WAITING.asked(waitTime(elapsed))];
  if (o.next) lines.push(o.next);
  if (o.setupPct !== undefined) lines.push(fill(PREPARING_COPY.setup, { pct: o.setupPct }));
  else if (elapsed > WAITING_SLOW_MS && !o.quiet) lines.push(WAITING.busy);
  return lines;
}

export function PreparingCard({ liveSteps, answerPreview, startedAt, onStop, progressSupported, heading, next, setupPct }: PreparingCardProps) {
  const now = useNow(1000);
  const cloud = readsInCloud(liveSteps);
  const headingId = useId();
  // A step that already says why it waits (a first click, a background tab) is not followed by the busy line.
  const quiet = liveSteps.some((s) => s.id.endsWith(':wait-click') || s.id.endsWith(':hidden'));
  const lines = waitingLines(now - startedAt, { next, setupPct, quiet });

  return (
    <section className={styles.card} aria-busy="true" aria-labelledby={headingId} data-testid="preparing-card">
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading} dir="auto">
          {heading ?? PREPARING_COPY.heading}
        </h2>
        <Tag tone={cloud ? 'cloud' : 'device'}>
          {cloud ? PREPARING_COPY.tagCloud : PREPARING_COPY.tagDevice}
        </Tag>
      </div>

      {progressSupported ? (
        <ol className={styles.rows}>
          {liveSteps.map((s) => (
            <li key={s.id} className={styles.row} data-status={s.status}>
              {s.status === 'running' ? (
                <span className={styles.dot} aria-hidden="true" />
              ) : (
                <Icon name="check" size={16} className={styles.check} />
              )}
              <span className={styles.rowLabel} dir="auto">
                {s.status === 'done' && s.step ? s.step.label : s.label}
              </span>
              {s.status === 'done' && s.step ? <span className={styles.ms}>{formatMs(s.step.ms)}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <ProgressBar label={PREPARING_COPY.progressLabel} />
      )}

      {progressSupported && answerPreview !== '' ? (
        <div className={styles.answer}>
          <p className={styles.eyebrow}>{PREPARING_COPY.answerEyebrow}</p>
          <p className={styles.answerText} dir="auto" data-testid="streamed-answer">
            {answerPreview}
            <span className={styles.caret} aria-hidden="true" />
          </p>
          <p className={styles.checking}>{PREPARING_COPY.checking}</p>
        </div>
      ) : null}

      {lines.map((line) => (
        <p key={line} className={styles.slow} data-testid="waiting-line">
          {line}
        </p>
      ))}

      <div>
        <Button variant="secondary" onClick={onStop}>
          {PREPARING_COPY.stop}
        </Button>
      </div>
    </section>
  );
}
