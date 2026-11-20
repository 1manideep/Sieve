// Offline banner (40 section 7.4): full-width amber bar under the header while the browser is offline.
import { SHELL } from '@/copy/strings';
import { useNetwork } from '@/state/network';
import { Icon } from '../icons';
import styles from './OfflineBanner.module.css';

export function OfflineBanner() {
  const online = useNetwork((s) => s.online);
  if (online) return null;
  return (
    <div className={styles.banner} role="status">
      <div className={styles.inner}>
        <Icon name="warning" size={20} className={styles.icon} />
        <p className={styles.text}>{SHELL.offline}</p>
      </div>
    </div>
  );
}
