// MainLayout: the 280 px left rail (docs/design/final-flow.md, F3 and F5) and the black content area.
// Rail: Sieve, the account circle, New ask / Try on a real computer, the Control links and the Nano meter card at the
// bottom. Under 1024px the rail is a top bar with a menu button that opens the same links. /setup renders the rail
// without the nav, as before.
import { useId, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AccountMenu } from '@/components/AccountMenu/AccountMenu';
import { Icon } from '@/components/icons';
import { Logo } from '@/components/Logo/Logo';
import { MainNav } from '@/components/MainNav/MainNav';
import { OfflineBanner } from '@/components/OfflineBanner/OfflineBanner';
import { StatusStrip } from '@/components/StatusStrip/StatusStrip';
import { NAV } from '@/copy/strings';
import styles from './MainLayout.module.css';

export function MainLayout() {
  const { pathname } = useLocation();
  const setup = pathname === '/setup';
  // The phone menu remembers the path it was opened on, so it closes by itself when the route changes.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const bodyId = useId();

  return (
    <div className={styles.shell}>
      <header className={open ? `${styles.rail} ${styles.open}` : styles.rail}>
        <div className={styles.top}>
          <Logo to="/" />
          <div className={styles.topRight}>
            <AccountMenu />
            <button
              type="button"
              className={styles.menuButton}
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpenOn(open ? null : pathname)}
            >
              <Icon name={open ? 'close' : 'menu'} size={20} />
              <span className="visually-hidden">{open ? NAV.closeMenu : NAV.menu}</span>
            </button>
          </div>
        </div>
        <div id={bodyId} className={styles.body}>
          {setup ? null : <MainNav />}
          <div className={styles.meter}>
            <StatusStrip layout="card" />
          </div>
        </div>
      </header>
      <div className={styles.content}>
        <OfflineBanner />
        <main id="main" tabIndex={-1} className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
