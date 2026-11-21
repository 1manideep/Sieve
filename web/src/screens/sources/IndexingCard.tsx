// IndexingCard (40 section 13.6; two stages since Nov 21, 2026): indexing on this device, from useIndexing. First
// it counts the items that can be searched; once all can, it says "Ready to ask" and shows Gemini Nano's sorting,
// the personal-details check and the photo captions as background work. It also says why it is paused.
import { useShallow } from 'zustand/shallow';
import { Button } from '@/components/Button/Button';
import { Icon } from '@/components/icons';
import { ProgressBar } from '@/components/ProgressBar/ProgressBar';
import { SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount, formatEta } from '@/copy/format';
import { useIndexing, type IndexingActivity } from '@/state/indexing';
import type { InventoryKind } from '@/state/localDb';
import { Fill } from '../settings/kit/Fill';
import kit from '../settings/kit/kit.module.css';
import { formatRelative, isoTime } from '../settings/kit/when';
import styles from './sources.module.css';

const INVENTORY_ORDER: readonly InventoryKind[] = ['pdfs', 'notes', 'photos', 'files', 'emails'];

/** "7 PDFs, 3 notes and 12 photos". */
export function inventoryList(inventory: IndexingActivity['inventory']): string {
  const parts = INVENTORY_ORDER.flatMap((k) => {
    const n = inventory?.[k] ?? 0;
    if (n <= 0) return [];
    const [one, many] = SOURCES.inventory[k];
    return [`${formatCount(n)} ${n === 1 ? one : many}`];
  });
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The line that says what Sieve works on now. */
export function activityText(activity: IndexingActivity): string {
  const n = activity.count ?? 0;
  switch (activity.stage) {
    case 'reading': {
      const list = inventoryList(activity.inventory);
      return list ? fillText(SOURCES.stageReading, { list }) : SOURCES.stageReadingNew;
    }
    case 'label':
      return n === 1 ? SOURCES.stageLabelOne : fillText(SOURCES.stageLabel, { n: formatCount(n) });
    case 'embed':
      return SOURCES.stageEmbed;
    case 'privacy':
      return SOURCES.stagePrivacy;
    case 'caption':
      return n === 1 ? SOURCES.stageCaptionOne : fillText(SOURCES.stageCaption, { n: formatCount(n) });
  }
}

/** What the background stage is doing, once everything is searchable. */
export function backgroundText(activity: IndexingActivity | undefined): string {
  const n = activity?.count ?? 0;
  switch (activity?.stage) {
    case 'label':
      return n === 1 ? SOURCES.bgLabelOne : n > 1 ? fillText(SOURCES.bgLabel, { n: formatCount(n) }) : SOURCES.bgWork;
    case 'caption':
      return n === 1 ? SOURCES.bgCaptionOne : n > 1 ? fillText(SOURCES.bgCaption, { n: formatCount(n) }) : SOURCES.bgWork;
    case 'privacy':
      return SOURCES.bgPrivacy;
    case 'embed':
      return SOURCES.bgEmbed;
    default:
      return SOURCES.bgWork;
  }
}

/**
 * Two stages. While items are still being read and embedded the card says "Indexing" and counts the items that can
 * be searched. Once every item can be searched it says "Ready to ask", and Gemini Nano's sorting, the
 * personal-details check and the photo captions show as background work with their own bar.
 * `resume`: the card's own Resume for the battery pause. `plain`: no card around it (inside the Sources panel).
 */
export function IndexingCard({ lastSyncAt, resume = true, plain = false }: { lastSyncAt?: number; resume?: boolean; plain?: boolean }) {
  const frame = plain ? styles.indexingPlain : `${kit.glassSm} ${styles.indexing}`;
  const { state, pausedBy, left, done, total, fraction, etaMs, activity, counting, ready, searchLeft, searchFraction } = useIndexing(
    useShallow((s) => ({
      state: s.state, pausedBy: s.pausedBy, left: s.left, done: s.done, total: s.total, fraction: s.fraction, etaMs: s.etaMs, activity: s.activity, counting: s.counting,
      ready: s.ready, searchLeft: s.searchLeft, searchFraction: s.searchFraction,
    })),
  );

  if (state === 'idle') {
    return (
      <section className={frame} aria-label={SOURCES.idleTitle}>
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

  const battery = state === 'paused' && pausedBy === 'battery';
  const resumeButton =
    battery && resume ? (
      <div className={styles.buttons}>
        <Button variant="secondary" size="sm" onClick={() => useIndexing.getState().resumeOnBattery()}>
          {SOURCES.batteryResume}
        </Button>
      </div>
    ) : null;

  if (ready) {
    let text: string;
    if (battery) text = SOURCES.batteryText;
    else if (state === 'paused') text = fillText(SOURCES.bgPausedText, { left: formatCount(left) });
    else if (state === 'yielding') text = SOURCES.yieldingText;
    else if (etaMs !== undefined) text = fillText(SOURCES.bgText, { done: formatCount(done), total: formatCount(total), eta: formatEta(etaMs) });
    else text = fillText(SOURCES.bgLeft, { left: formatCount(left) });
    return (
      <section className={frame} aria-labelledby="indexing-card-title">
        <h2 id="indexing-card-title" className={styles.cardTitle}>
          <span className={styles.check}>
            <Icon name="check" size={18} />
          </span>
          {SOURCES.readyTitle}
        </h2>
        <p className={styles.text}>{fillText(SOURCES.readyText, { total: formatCount(total) })}</p>
        <p className={styles.stage}>{backgroundText(activity)}</p>
        <ProgressBar value={total > 0 ? fraction : undefined} label={SOURCES.bgProgressLabel} valueText={fillText(SOURCES.indexingLabel, { done: formatCount(done), total: formatCount(total) })} />
        <p className={styles.text}>{text}</p>
        {state === 'running' ? <p className={styles.meta}>{SOURCES.bgSub}</p> : null}
        {resumeButton}
      </section>
    );
  }

  // Not everything is searchable yet. `searchLeft` is 0 only while a source is still counting (or on a row an older
  // queue wrote): then the overall numbers stand in.
  const toSearch = searchLeft > 0 ? searchLeft : left;
  const searchable = Math.max(0, total - toSearch);
  const title = state === 'paused' ? SOURCES.pausedTitle : SOURCES.runningTitle;
  const valueText = fillText(SOURCES.searchValue, { done: formatCount(searchable), total: formatCount(total) });
  let text: string;
  if (battery) text = SOURCES.batteryText;
  else if (state === 'paused') text = fillText(SOURCES.pausedText, { left: formatCount(toSearch) });
  else if (state === 'yielding') text = SOURCES.yieldingText;
  else if (counting) text = fillText(SOURCES.runningSoFar, { done: formatCount(searchable), total: formatCount(total) });
  else if (etaMs !== undefined)
    text = fillText(SOURCES.runningText, { done: formatCount(searchable), total: formatCount(total), eta: formatEta(etaMs) });
  else text = fillText(SOURCES.runningLeft, { left: formatCount(toSearch) });

  return (
    <section className={frame} aria-labelledby="indexing-card-title">
      <h2 id="indexing-card-title" className={styles.cardTitle}>
        {title}
      </h2>
      <ProgressBar value={total > 0 ? (searchLeft > 0 ? searchFraction : fraction) : undefined} label={SOURCES.progressLabel} valueText={valueText} />
      {state === 'running' && activity ? <p className={styles.stage}>{activityText(activity)}</p> : null}
      <p className={styles.text}>{text}</p>
      {state === 'running' ? <p className={styles.meta}>{SOURCES.runningSub}</p> : null}
      {resumeButton}
    </section>
  );
}
