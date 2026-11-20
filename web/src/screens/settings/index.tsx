// Settings (40 section 13.8; docs/design/final-flow.md F5): two columns. Left: category rules, default step, cloud
// fallback. Right: assistants, notifications and this computer, account. Hash targets #ais, #rules, #default-step,
// #cloud, #notifications, #account.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { SENTENCE } from '@/copy/screens-controls';
import { SCREENS, TITLES } from '@/copy/strings';
import { useDb } from '@/components/dbTables';
import { connectedSources, useSourceRows } from '../sources/sourcesDb';
import { AccountCard } from './AccountCard';
import { AisCard } from './AisCard';
import kit from './kit/kit.module.css';
import { ScreenHead } from './kit/ScreenHead';
import { NotificationsCard } from './NotificationsCard';
import { CloudCard, DefaultStepCard, RulesCard } from './PreferenceCards';
import styles from './settings.module.css';

export const SETTINGS_HASHES = ['ais', 'rules', 'default-step', 'cloud', 'notifications', 'account'] as const;

/** On load with a hash, scroll to that card and focus its H2. */
function useHashFocus(): void {
  const { hash } = useLocation();
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!(SETTINGS_HASHES as readonly string[]).includes(id)) return;
    const heading = document.getElementById(`${id}-heading`);
    if (!heading) return;
    document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
    heading.focus({ preventScroll: true });
  }, [hash]);
}

export function Component() {
  useDocumentTitle(TITLES.settings);
  useHashFocus();
  const db = useDb('real');
  const rows = useSourceRows(db);

  return (
    <div className={kit.screen}>
      <ScreenHead title={SCREENS.settings.heading} tryNow />
      <div className={styles.grid}>
        <div className={styles.column}>
          <RulesCard />
          <DefaultStepCard />
          <CloudCard />
        </div>
        <div className={styles.column}>
          <AisCard connected={connectedSources(rows)} />
          <NotificationsCard />
          <AccountCard />
        </div>
      </div>
      <p className={kit.sentence}>{SENTENCE}</p>
    </div>
  );
}
