// Settings (40 section 13.8; docs/design/final-flow.md F5, F5B since Nov 20): the assistants first, as a row of
// marks with the connections below; then three calm groups (Your rules, Notifications, Account); the default step
// and cloud fallback under one "More settings" disclosure. Hash targets #ais, #rules, #default-step, #cloud,
// #notifications, #account still work: a hash inside the disclosure opens it.
import { useEffect, useId, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Icon } from '@/components/icons';
import { SENTENCE, SETTINGS } from '@/copy/screens-controls';
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
const MORE_HASHES = ['default-step', 'cloud'] as const;

/** On load with a hash, scroll to that card and focus its H2 (after the disclosure opened, when it holds the card). */
function useHashFocus(moreOpen: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!(SETTINGS_HASHES as readonly string[]).includes(id)) return;
    const heading = document.getElementById(`${id}-heading`);
    if (!heading) return;
    document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
    heading.focus({ preventScroll: true });
  }, [hash, moreOpen]);
}

export function Component() {
  useDocumentTitle(TITLES.settings);
  const { hash } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  // A hash that names a card inside the disclosure opens it (state adjusted during render, once per hash).
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if ((MORE_HASHES as readonly string[]).includes(hash.replace(/^#/, '')) && openedFor !== hash) {
    setOpenedFor(hash);
    setMoreOpen(true);
  }
  useHashFocus(moreOpen);
  const moreId = useId();
  const db = useDb('real');
  const rows = useSourceRows(db);

  return (
    <div className={kit.screen}>
      <ScreenHead title={SCREENS.settings.heading} tryNow />
      <div className={styles.top}>
        <AisCard connected={connectedSources(rows)} />
      </div>
      <div className={styles.grid}>
        <div className={styles.column}>
          <RulesCard />
        </div>
        <div className={styles.column}>
          <NotificationsCard />
          <AccountCard />
        </div>
      </div>
      <div className={styles.moreWrap}>
        <button type="button" className={styles.moreButton} aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen((v) => !v)}>
          <Icon name={moreOpen ? 'chevron-down' : 'chevron-right'} size={16} />
          {SETTINGS.moreHeading}
          <span className={styles.moreSub}>{SETTINGS.moreSub}</span>
        </button>
        <div id={moreId} className={`${styles.more} ${styles.grid}`} hidden={!moreOpen}>
          <div className={styles.column}>
            <DefaultStepCard />
          </div>
          <div className={styles.column}>
            <CloudCard />
          </div>
        </div>
      </div>
      <p className={kit.sentence}>{SENTENCE}</p>
    </div>
  );
}
