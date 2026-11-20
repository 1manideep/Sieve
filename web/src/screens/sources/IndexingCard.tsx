// IndexingCard (40 section 13.6; F5): background indexing on this device, from useIndexing, as one glass row.
import { useShallow } from 'zustand/shallow';
import { Icon } from '@/components/icons';
import { ProgressBar } from '@/components/ProgressBar/ProgressBar';
import { SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount, formatEta } from '@/copy/format';
import { useIndexing } from '@/state/indexing';
import { Fill } from '../settings/kit/Fill';
import kit from '../settings/kit/kit.module.css';
import { formatRelative, isoTime } from '../settings/kit/when';
import styles from './sources.module.css';

export function IndexingCard({ lastSyncAt }: { lastSyncAt?: number }) {
  const { state, left, done, total, etaMs } = useIndexing(
    useShallow((s) => ({ state: s.state, left: s.left, done: s.done, total: s.total, etaMs: s.etaMs })),
  );

  if (state === 'idle') {
    return (
      <section className={`${kit.glassSm} ${styles.indexing}`} aria-label={SOURCES.idleTitle}>
        <p className={styles.upToDate}>
          <span className={styles.check}>
            <Icon name="check" size={20} />
          </span>
          {SOURCES.idleTitle}
        </p>
        {lastSyncAt !== undefined ? (
          <p className={styles.meta}>
            <Fill
              template={SOURCES.lastUpdated}
              values={{ when: <time dateTime={isoTime(lastSyncAt)}>{formatRelative(lastSyncAt)}</time> }}
            />
          </p>
        ) : null}
      </section>
    );
  }

  const title = state === 'paused' ? SOURCES.pausedTitle : SOURCES.runningTitle;
  const valueText = fillText(SOURCES.indexingLabel, { done: formatCount(done), total: formatCount(total) });
  let text: string;
  if (state === 'paused') text = fillText(SOURCES.pausedText, { left: formatCount(left) });
  else if (state === 'yielding') text = SOURCES.yieldingText;
  else if (etaMs !== undefined)
    text = fillText(SOURCES.runningText, { done: formatCount(done), total: formatCount(total), eta: formatEta(etaMs) });
  else text = fillText(SOURCES.runningLeft, { left: formatCount(left) });

  return (
    <section className={`${kit.glassSm} ${styles.indexing}`} aria-labelledby="indexing-card-title">
      <h2 id="indexing-card-title" className={styles.cardTitle}>
        {title}
      </h2>
      <ProgressBar value={total > 0 ? done / total : undefined} label={SOURCES.progressLabel} valueText={valueText} />
      <p className={styles.text}>{text}</p>
      {state === 'running' ? <p className={styles.meta}>{SOURCES.runningSub}</p> : null}
    </section>
  );
}
