// "Sieve was updated in another tab" (70 R-PLAT-09): another tab deleted or upgraded a database this tab had open.
// index/db.ts closed it here so that tab could go on; this tab has to reload to open the new one.
import { useEffect, useState } from 'react';
import { SHELL } from '@/copy/strings';
import { onIndexEvent } from '@/index/events';
import { Button } from '../Button/Button';
import { Icon } from '../icons';
import styles from './TabClosedBanner.module.css';

export function TabClosedBanner() {
  const [closed, setClosed] = useState(false);
  useEffect(
    () =>
      onIndexEvent((e) => {
        if (e.type === 'db-closed') setClosed(true);
      }),
    [],
  );
  if (!closed) return null;
  return (
    <div className={styles.banner} role="alert">
      <div className={styles.inner}>
        <Icon name="warning" size={20} className={styles.icon} />
        <p className={styles.text}>{SHELL.updatedInAnotherTab}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          {SHELL.reload}
        </Button>
      </div>
    </div>
  );
}
