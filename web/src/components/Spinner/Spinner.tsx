// Spinner (40 section 16.19): a 2px ring; static under reduced motion, with the hidden label "Working".
import { SHELL } from '@/copy/strings';
import styles from './Spinner.module.css';

export interface SpinnerProps {
  size?: 16 | 20;
  /** Hide the "Working" label when the surrounding control already says what is happening. */
  labelled?: boolean;
}

export function Spinner({ size = 16, labelled = true }: SpinnerProps) {
  return (
    <span className={styles.wrap}>
      <span className={styles.ring} style={{ width: size, height: size }} aria-hidden="true" />
      {labelled ? <span className="visually-hidden">{SHELL.working}</span> : null}
    </span>
  );
}
