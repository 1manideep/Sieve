// Main navigation (40 section 7.2): Ask · Requests [badge] · Sources · What has AI seen? · Settings.
import { NavLink } from 'react-router-dom';
import { NAV } from '@/copy/strings';
import { useHomeBase } from '@/state/homeBase';
import styles from './MainNav.module.css';

const LINKS = [
  { to: '/', label: NAV.ask, end: true },
  { to: '/requests', label: NAV.requests, end: false },
  { to: '/sources', label: NAV.sources, end: false },
  { to: '/seen', label: NAV.seen, end: false },
  { to: '/settings', label: NAV.settings, end: false },
] as const;

export function MainNav() {
  const waiting = useHomeBase((s) => s.awaitingCount);
  return (
    <nav aria-label={NAV.label} className={styles.nav}>
      <ul className={styles.list}>
        {LINKS.map((link) => {
          const badge = link.to === '/requests' && waiting > 0;
          return (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.end}
                className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
                aria-label={badge ? NAV.requestsWaiting(waiting) : undefined}
              >
                {link.label}
                {badge ? (
                  <span className={styles.badge} aria-hidden="true">
                    {waiting}
                  </span>
                ) : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
