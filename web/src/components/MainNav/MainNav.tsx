// Main navigation, as a 72px rail of icons (design handoff of Nov 20, 2026, after Gemini's collapsed sidebar): New
// ask, Try on a real computer, Requests (a dot when one waits), What has AI seen? and Sources; at the bottom the
// share of items never shared, then Settings. Each icon names itself in a tooltip on hover and focus.
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { loadIndex, tablesOf } from '@/components/dbTables';
import { formatCount } from '@/copy/format';
import { NAV } from '@/copy/strings';
import { useHomeBase } from '@/state/homeBase';
import { sharedItemCount, useReceipts } from '@/state/receipts';
import styles from './MainNav.module.css';

const GEAR =
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';

const LINKS = [
  { to: '/ask', label: NAV.newAsk, d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
  { to: '/try', label: NAV.tryComputer, d: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 20h8M12 16v4' },
  { to: '/requests', label: NAV.requests, d: 'M4 13l2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4l1 2h6l1-2h4' },
  { to: '/seen', label: NAV.seen, d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z' },
  { to: '/sources', label: NAV.sources, d: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 16.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM19 16.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 7.3L6 15M13 7.3l5 7.7' },
] as const;

function RailIcon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const itemClass = ({ isActive }: { isActive: boolean }) => (isActive ? `${styles.it} ${styles.active}` : styles.it);

/** Items in the real index, counted again on each route change (a count, never a read of the items). */
function useItemCount(): number | undefined {
  const { pathname } = useLocation();
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadIndex()
      .then((m) => tablesOf(m.openDb('real')).records.count())
      .then((n) => {
        if (live) setCount(n);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pathname]);
  return count;
}

/** The ring at the bottom of the rail: the share of items on this computer that no AI has ever received. */
function NeverShared() {
  const total = useItemCount();
  const receipts = useReceipts((s) => s.receipts);
  const shared = useMemo(() => sharedItemCount(receipts), [receipts]);
  if (total === undefined || total === 0) return null;
  const never = Math.max(0, total - shared);
  const pct = Math.floor((never / total) * 100);
  return (
    <li>
      <NavLink to="/sources" className={styles.it} aria-label={NAV.neverShared(pct)}>
        <span className={styles.ring} style={{ ['--shared' as string]: `${100 - pct}%` }}>
          <span className={styles.ringIn}>{pct}%</span>
        </span>
        <span className={styles.tip} aria-hidden="true">
          {NAV.neverSharedTip(formatCount(never), formatCount(total))}
        </span>
      </NavLink>
    </li>
  );
}

export function MainNav() {
  const waiting = useHomeBase((s) => s.awaitingCount);
  return (
    <nav aria-label={NAV.label} className={styles.nav}>
      <ul className={styles.list}>
        {LINKS.map((link) => {
          const badge = link.to === '/requests' && waiting > 0;
          return (
            <li key={link.to}>
              <NavLink to={link.to} end={link.to === '/ask'} className={itemClass} aria-label={badge ? NAV.requestsWaiting(waiting) : link.label}>
                <RailIcon d={link.d} />
                {badge ? <span className={styles.badge} aria-hidden="true" /> : null}
                <span className={styles.tip} aria-hidden="true">
                  {link.label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      <ul className={`${styles.list} ${styles.foot}`}>
        <NeverShared />
        <li>
          <NavLink to="/settings" className={itemClass} aria-label={NAV.settings}>
            <RailIcon d={GEAR} />
            <span className={styles.tip} aria-hidden="true">
              {NAV.settings}
            </span>
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
