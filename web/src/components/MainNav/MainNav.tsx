// Main navigation, the rail's links (docs/design/final-flow.md, F3 and F5): New ask and Try on a real computer,
// then the Control group: Requests [badge] · What has AI seen? · Sources · Settings.
import { NavLink } from 'react-router-dom';
import { NAV } from '@/copy/strings';
import { useHomeBase } from '@/state/homeBase';
import { Icon, type IconName } from '../icons';
import styles from './MainNav.module.css';

const PRIMARY: readonly { to: string; label: string; icon: IconName; end: boolean }[] = [
  { to: '/', label: NAV.newAsk, icon: 'pencil', end: true },
  { to: '/try', label: NAV.tryComputer, icon: 'monitor', end: false },
];

const LINKS = [
  { to: '/requests', label: NAV.requests, end: false },
  { to: '/seen', label: NAV.seen, end: false },
  { to: '/sources', label: NAV.sources, end: false },
  { to: '/settings', label: NAV.settings, end: false },
] as const;

function linkClass(isActive: boolean, extra?: string): string {
  return [styles.link, isActive ? styles.active : '', extra].filter(Boolean).join(' ');
}

export function MainNav() {
  const waiting = useHomeBase((s) => s.awaitingCount);
  return (
    <nav aria-label={NAV.label} className={styles.nav}>
      <ul className={styles.list}>
        {PRIMARY.map((link) => (
          <li key={link.to}>
            <NavLink to={link.to} end={link.end} className={({ isActive }) => linkClass(isActive, link.to === '/' ? styles.strong : undefined)}>
              <Icon name={link.icon} size={18} className={styles.icon} />
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <p className={styles.section} aria-hidden="true">{NAV.control}</p>
      <ul className={styles.list} aria-label={NAV.control}>
        {LINKS.map((link) => {
          const badge = link.to === '/requests' && waiting > 0;
          return (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.end}
                className={({ isActive }) => linkClass(isActive)}
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
