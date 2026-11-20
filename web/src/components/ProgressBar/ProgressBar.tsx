// ProgressBar (40 section 16.1): value 0..1; undefined is indeterminate. 8px tall, pill, teal fill.
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  value?: number;
  label: string;
  valueText?: string;
}

export function ProgressBar({ value, label, valueText }: ProgressBarProps) {
  const clamped = value === undefined ? undefined : Math.min(1, Math.max(0, value));
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === undefined ? undefined : Math.round(clamped * 100)}
      aria-valuetext={valueText}
    >
      <div
        className={clamped === undefined ? `${styles.fill} ${styles.indeterminate}` : styles.fill}
        style={clamped === undefined ? undefined : { width: `${clamped * 100}%` }}
      />
    </div>
  );
}
