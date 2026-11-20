// MainLayout (40 section 7.2): header with logo, nav, Playground button, status strip and account menu.
// /setup renders the header without the nav and without the Playground button.
import { Outlet, useLocation } from 'react-router-dom';
import { AccountMenu } from '@/components/AccountMenu/AccountMenu';
import { LinkButton } from '@/components/Button/Button';
import { Logo } from '@/components/Logo/Logo';
import { MainNav } from '@/components/MainNav/MainNav';
import { OfflineBanner } from '@/components/OfflineBanner/OfflineBanner';
import { StatusStrip } from '@/components/StatusStrip/StatusStrip';
import { NAV } from '@/copy/strings';
import styles from './MainLayout.module.css';

export function MainLayout() {
  const setup = useLocation().pathname === '/setup';
  return (
    <>
      <header className={styles.appHeader}>
        <div className={`${styles.inner} ${setup ? styles.setup : ''}`}>
          <div className={styles.logo}>
            <Logo to="/" />
          </div>
          {setup ? null : (
            <div className={styles.nav}>
              <MainNav />
            </div>
          )}
          <div className={styles.right}>
            {setup ? null : (
              <LinkButton to="/playground" variant="secondary" size="sm">
                {NAV.playground}
              </LinkButton>
            )}
            <StatusStrip />
            <AccountMenu />
          </div>
        </div>
      </header>
      <OfflineBanner />
      <main id="main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
