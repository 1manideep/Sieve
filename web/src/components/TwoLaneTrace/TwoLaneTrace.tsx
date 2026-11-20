// TwoLaneTrace (00 D4): a device lane and a cloud lane side by side, with the characters that crossed on the arrow
// between them. Lanes follow each step's `where` exactly as the trace recorded it.
import { useId } from 'react';
import type { TraceStep } from '@sieve/shared';
import { formatCount } from '@/copy/format';
import { TWO_LANE_COPY, fill } from '@/copy/screens-main';
import { Icon } from '../icons';
import styles from './TwoLaneTrace.module.css';

export interface TwoLaneTraceProps {
  steps: TraceStep[];
}

export function crossedText(steps: TraceStep[]): string {
  const n = steps.reduce((sum, s) => sum + (s.charsSent ?? 0), 0);
  if (n === 0) return TWO_LANE_COPY.crossedNone;
  return n === 1 ? TWO_LANE_COPY.crossedOne : fill(TWO_LANE_COPY.crossedMany, { n: formatCount(n) });
}

function Lane({ title, steps, empty, tone }: { title: string; steps: TraceStep[]; empty: string; tone: 'device' | 'cloud' }) {
  const id = useId();
  return (
    <div className={`${styles.lane} ${tone === 'device' ? styles.device : styles.cloud}`} data-lane={tone}>
      <p id={id} className={styles.laneTitle}>
        <Icon name={tone === 'device' ? 'device' : 'cloud'} size={16} />
        {title}
      </p>
      {steps.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ol className={styles.items} aria-labelledby={id}>
          {steps.map((s, i) => (
            <li key={`${s.kind}-${s.at}-${i}`} className={styles.item}>
              {TWO_LANE_COPY.kinds[s.kind]}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TwoLaneTrace({ steps }: TwoLaneTraceProps) {
  const device = steps.filter((s) => s.where !== 'cloud');
  const cloud = steps.filter((s) => s.where === 'cloud');
  const crossed = crossedText(steps);
  const anyCrossed = crossed !== TWO_LANE_COPY.crossedNone;
  return (
    <div className={styles.lanes} role="group" aria-label={TWO_LANE_COPY.label}>
      <Lane title={TWO_LANE_COPY.deviceLane} steps={device} empty={TWO_LANE_COPY.emptyDevice} tone="device" />
      <div className={`${styles.arrow} ${anyCrossed ? styles.crossed : ''}`} data-testid="lane-arrow">
        <span className={styles.line} aria-hidden="true" />
        <span className={styles.arrowText}>{crossed}</span>
        <span className={styles.head} aria-hidden="true">
          <Icon name="chevron-right" size={16} />
        </span>
      </div>
      <Lane title={TWO_LANE_COPY.cloudLane} steps={cloud} empty={TWO_LANE_COPY.emptyCloud} tone="cloud" />
    </div>
  );
}
