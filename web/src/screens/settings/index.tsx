// Settings (40 section 13.8): AIs that can ask, category rules, default step, cloud fallback, notifications and this
// computer, account. Hash targets #ais, #rules, #default-step, #cloud, #notifications, #account.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { SCREENS, TITLES } from '@/copy/strings';
import { useDb } from '@/components/dbTables';
import { connectedSources, useSourceRows } from '../sources/sourcesDb';
import { AccountCard } from './AccountCard';
import { AisCard } from './AisCard';
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
    <div className={styles.page}>
      <PageHeader title={SCREENS.settings.heading} lead={SCREENS.settings.lead} size="page" />
      <div className={styles.grid}>
        <AisCard connected={connectedSources(rows)} />
        <RulesCard />
        <DefaultStepCard />
        <CloudCard />
        <NotificationsCard />
        <AccountCard />
      </div>
    </div>
  );
}
