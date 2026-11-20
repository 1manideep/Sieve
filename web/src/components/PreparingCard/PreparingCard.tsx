// PreparingCard (40 sections 12.4 and 16.8): fills as the pipeline works, so the ~10 s on-device wait feels
// purposeful. Labels are the pipeline's; the streamed answer is shown, never sent, and never announced token by token.
import { useEffect, useId, useState } from 'react';
import type { LiveStep } from '@/state/types';
import { PREPARING_COPY } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { Icon } from '../icons';
import { ProgressBar } from '../ProgressBar/ProgressBar';
import { Tag } from '../Tag/Tag';
import { formatMs } from '../TraceList/TraceList';
import styles from './PreparingCard.module.css';

export interface PreparingCardProps {
  liveSteps: LiveStep[];
  answerPreview: string;
  startedAt: number;
  onStop(): void;
  progressSupported: boolean;     // false when CR-3 onProgress is absent
}

export const SLOW_LINE_MS = 3000;

/** The reading step reports where it runs; a cloud select or answer turns the tag blue (sample data without Nano). */
export function readsInCloud(steps: LiveStep[]): boolean {
  return steps.some((s) => (s.kind === 'select' || s.kind === 'answer') && (s.step?.where ?? s.where) === 'cloud');
}

function useSlowLine(startedAt: number, answerPreview: string, always: boolean): boolean {
  const [elapsedFor, setElapsedFor] = useState<number | null>(null);
  useEffect(() => {
    const left = Math.max(0, SLOW_LINE_MS - (Date.now() - startedAt));
    const timer = setTimeout(() => setElapsedFor(startedAt), left);
    return () => clearTimeout(timer);
  }, [startedAt]);
  return always || (elapsedFor === startedAt && answerPreview === '');
}

export function PreparingCard({ liveSteps, answerPreview, startedAt, onStop, progressSupported }: PreparingCardProps) {
  const slow = useSlowLine(startedAt, answerPreview, !progressSupported);
  const cloud = readsInCloud(liveSteps);
  const headingId = useId();

  return (
    <section className={styles.card} aria-busy="true" aria-labelledby={headingId} data-testid="preparing-card">
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          {PREPARING_COPY.heading}
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

      {slow ? <p className={styles.slow}>{PREPARING_COPY.slow}</p> : null}

      <div>
        <Button variant="secondary" onClick={onStop}>
          {PREPARING_COPY.stop}
        </Button>
      </div>
    </section>
  );
}
