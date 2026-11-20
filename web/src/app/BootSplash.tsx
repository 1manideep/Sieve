// BootSplash (40 section 4.1): centred logo and wordmark; after 400 ms a 2px teal indeterminate bar.
import { Logo } from '@/components/Logo/Logo';
import { SHELL } from '@/copy/strings';
import styles from './BootSplash.module.css';

export function BootSplash() {
  return (
    <div className={styles.splash} aria-busy="true">
      <div className={styles.center}>
        <Logo size="splash" />
        <div className={styles.bar} aria-hidden="true" />
        <span className="visually-hidden">{SHELL.loading}</span>
      </div>
    </div>
  );
}
