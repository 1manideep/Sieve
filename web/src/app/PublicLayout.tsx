// PublicLayout: the public header (docs/design/final-flow.md, F2): "Sieve" with the OPEN SOURCE pill on the left;
// How it works, Playground, Try on a real computer, GitHub and the white Open Sieve pill on the right. Under 1024px
// the text links sit behind a menu button. The footer carries the sentence. On /welcome the header floats over the
// stage (the board draws the stars behind it), and /welcome and /try draw their own footers.
import { useId, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { env } from '@/app/env';
import { LinkButton } from '@/components/Button/Button';
import { Icon } from '@/components/icons';
import { Logo } from '@/components/Logo/Logo';
import { PUBLIC_NAV } from '@/copy/strings';
import styles from './PublicLayout.module.css';

const LINKS = [
  { to: '/how', label: PUBLIC_NAV.how },
  { to: '/playground', label: PUBLIC_NAV.playground },
  { to: '/try', label: PUBLIC_NAV.tryComputer },
] as const;

/** Screens that draw their own footer line. */
const OWN_FOOTER = new Set(['/welcome', '/try']);

export function PublicLayout() {
  const { pathname } = useLocation();
  // The phone menu remembers the path it was opened on, so it closes by itself when the route changes.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const navId = useId();
  const overlay = pathname === '/welcome';

  const shell = [styles.shell, overlay ? styles.overlay : ''].filter(Boolean).join(' ');
  const header = [styles.header, open ? styles.menuOpen : ''].filter(Boolean).join(' ');

  return (
    <div className={shell}>
      <header className={header}>
        <div className={styles.inner}>
          <div className={styles.brand}>
            <Logo to="/welcome" />
            <span className={styles.openSource}>{PUBLIC_NAV.openSource}</span>
          </div>
          <button
            type="button"
            className={styles.menuButton}
            aria-expanded={open}
            aria-controls={navId}
            onClick={() => setOpenOn(open ? null : pathname)}
          >
            <Icon name={open ? 'close' : 'menu'} size={20} />
            <span className="visually-hidden">{open ? PUBLIC_NAV.closeMenu : PUBLIC_NAV.menu}</span>
          </button>
          <nav id={navId} aria-label={PUBLIC_NAV.label} className={styles.nav}>
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}>
                {link.label}
              </NavLink>
            ))}
            <a href={env.repoUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
              {PUBLIC_NAV.github}
            </a>
          </nav>
          <LinkButton to="/playground" variant="primary" size="md" className={styles.cta}>
            {PUBLIC_NAV.openSieve}
          </LinkButton>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      {OWN_FOOTER.has(pathname) ? null : <footer className={styles.footer}>{PUBLIC_NAV.footer}</footer>}
    </div>
  );
}
