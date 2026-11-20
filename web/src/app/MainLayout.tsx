// MainLayout: the 280 px left rail (docs/design/final-flow.md, F3 and F5) and the black content area.
// Rail: Sieve, the account circle, New ask / Try on a real computer, the Control links and the Nano meter card at the
// bottom. Under 1024px the rail is a top bar with a menu button that opens the same links. /setup renders the rail
// without the nav, as before. On wide screens "Hide menu" at the top of the rail hides it and the content takes the
// full width; "Show menu" at the top left of the content brings it back. The choice is kept per device.
import { useEffect, useId, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AccountMenu } from '@/components/AccountMenu/AccountMenu';
import { Icon } from '@/components/icons';
import { Logo } from '@/components/Logo/Logo';
import { MainNav } from '@/components/MainNav/MainNav';
import { OfflineBanner } from '@/components/OfflineBanner/OfflineBanner';
import { StatusStrip } from '@/components/StatusStrip/StatusStrip';
import { NAV } from '@/copy/strings';
import styles from './MainLayout.module.css';

/** localStorage: 'hidden' or 'shown', the rail on wide screens for this device. */
export const RAIL_KEY = 'sieve.rail';

function readRailHidden(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === 'hidden';
  } catch {
    return false;
  }
}

function writeRailHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(RAIL_KEY, hidden ? 'hidden' : 'shown');
  } catch {
    // This browser keeps nothing; the choice lasts until the page reloads.
  }
}

export function MainLayout() {
  const { pathname } = useLocation();
  const setup = pathname === '/setup';
  // The phone menu remembers the path it was opened on, so it closes by itself when the route changes.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const bodyId = useId();
  const railId = useId();
  const [railHidden, setRailHidden] = useState(readRailHidden);
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);

  // The button that was pressed goes away, so focus moves to the one that takes its place.
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (railHidden ? showRef : hideRef).current?.focus();
  }, [railHidden]);

  const setRail = (hidden: boolean) => {
    toggled.current = true;
    setRailHidden(hidden);
    writeRailHidden(hidden);
  };

  return (
    <div className={styles.shell} data-rail={railHidden ? 'hidden' : 'shown'}>
      <header id={railId} className={open ? `${styles.rail} ${styles.open}` : styles.rail}>
        <div className={styles.top}>
          <Logo to="/ask" />
          <div className={styles.topRight}>
            <AccountMenu />
            <button
              ref={hideRef}
              type="button"
              className={`${styles.railButton} ${styles.hideButton}`}
              aria-expanded={true}
              aria-controls={railId}
              onClick={() => setRail(true)}
            >
              <Icon name="sidebar" size={18} />
              <span className="visually-hidden">{NAV.hideMenu}</span>
            </button>
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
        {railHidden ? (
          <nav aria-label={NAV.menu} className={styles.reveal}>
            <button
              ref={showRef}
              type="button"
              className={styles.railButton}
              aria-expanded={false}
              aria-controls={railId}
              onClick={() => setRail(false)}
            >
              <Icon name="sidebar" size={18} />
              <span className="visually-hidden">{NAV.showMenu}</span>
            </button>
          </nav>
        ) : null}
        <OfflineBanner />
        <main id="main" tabIndex={-1} className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
