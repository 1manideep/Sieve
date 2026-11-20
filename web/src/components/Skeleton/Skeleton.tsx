// Skeleton (40 section 16.19): static muted blocks; no shimmer (15.6). Decorative.
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  lines?: number;
  height?: number;
}

export function Skeleton({ lines = 3, height = 14 }: SkeletonProps) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={styles.line} style={{ height, width: i === lines - 1 && lines > 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}
