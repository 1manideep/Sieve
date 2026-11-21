// Settings (40 section 13.8; design handoff of Nov 20, 2026): the assistants first, as bare marks with the selected
// one opened in one panel in place; then Your rules as tiles; Notifications and Account as rows on the ground; and
// "More", closed until pressed, with the default step, cloud fallback, past connections and Delete my account.
// Hash targets #ais, #rules, #default-step, #cloud, #notifications, #account still work: one inside More opens it.
import { useEffect, useId, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Icon } from '@/components/icons';
import { SENTENCE, SETTINGS, fillText } from '@/copy/screens-controls';
import { SCREENS, TITLES } from '@/copy/strings';
import { useDb } from '@/components/dbTables';
import { useGrants } from '@/state/grants';
import { connectedSources, useSourceRows } from '../sources/sourcesDb';
import { AccountCard, DeleteAccountRow } from './AccountCard';
import { AisCard } from './AisCard';
import ground from './kit/ground.module.css';
import kit from './kit/kit.module.css';
import { ScreenHead } from './kit/ScreenHead';
import { formatDate } from './kit/when';
import { NotificationsCard } from './NotificationsCard';
import { CloudCard, DefaultStepCard, RulesCard } from './PreferenceCards';
import styles from './settings.module.css';

export const SETTINGS_HASHES = ['ais', 'rules', 'default-step', 'cloud', 'notifications', 'account'] as const;
const MORE_HASHES = ['default-step', 'cloud'] as const;

/** On load with a hash, scroll to that part and focus its heading (after More opened, when it holds the part). */
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

/** Connections that ended: who, how and when, in one line each. */
function PastConnections() {
  const grants = useGrants((s) => s.grants);
  const past = grants.filter((g) => g.state === 'expired' || g.state === 'revoked');
  if (past.length === 0) return null;
  return (
    <li className={ground.row}>
      <span className={ground.rowText}>
        <span>{fillText(SETTINGS.past, { n: past.length })}</span>
      </span>
      <ul className={styles.past}>
        {past.map((g) => (
          <li key={g.id}>
            <bdi>
              {g.state === 'revoked'
                ? fillText(SETTINGS.pastRevoked, { aiName: g.aiName, date: formatDate(g.revokedAt ?? g.expiresAt) })
                : fillText(SETTINGS.pastExpired, { aiName: g.aiName, date: formatDate(g.expiresAt) })}
            </bdi>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function Component() {
  useDocumentTitle(TITLES.settings);
  const { hash } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  // A hash that names a part inside More opens it (state adjusted during render, once per hash).
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
    <div className={`${kit.screen} ${styles.screen}`}>
      <ScreenHead title={SCREENS.settings.heading} tryNow />
      <AisCard connected={connectedSources(rows)} />
      <RulesCard />
      <div className={styles.two}>
        <NotificationsCard />
        <AccountCard />
      </div>
      <div className={styles.moreWrap}>
        <button type="button" className={styles.moreButton} aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen((v) => !v)}>
          <Icon name={moreOpen ? 'chevron-down' : 'chevron-right'} size={16} />
          {SETTINGS.moreHeading}
          <span className={styles.moreSub}>{SETTINGS.moreSub}</span>
        </button>
        <ul id={moreId} className={ground.rows} aria-label={SETTINGS.moreHeading} hidden={!moreOpen}>
          <DefaultStepCard />
          <CloudCard />
          <PastConnections />
          <DeleteAccountRow />
        </ul>
      </div>
      <p className={kit.sentence}>{SENTENCE}</p>
    </div>
  );
}
