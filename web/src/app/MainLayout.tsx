// MainLayout: the 72px icon rail (design handoff of Nov 20, 2026) and the black content area. The rail holds the
// name, then MainNav's icons; under 720px it lies along the top. /setup shows the rail without the icons. While a
// Google session is open the layout also keeps the receipts listener, so the rail's "never shared" ring and What
// has AI seen? read the same list. At the top of the page, Gmail access running out shows on every page (lazy, so
// what loads after sign-in stays inside its budget, 40 section 17.1).
import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MainNav } from '@/components/MainNav/MainNav';
import { OfflineBanner } from '@/components/OfflineBanner/OfflineBanner';
import { APP_NAME } from '@/copy/strings';
import { useReceipts } from '@/state/receipts';
import { useSession } from '@/state/session';
import styles from './MainLayout.module.css';

const GmailAccess = lazy(() => import('@/components/GmailAccess/GmailAccess').then((m) => ({ default: m.GmailAccess })));

/**
 * The guard runs only when a route loads: when the Google session ends while a signed-in screen is open (sign-out or
 * Delete my account here, or in another tab), the page leaves for the landing at once.
 */
function useLeaveWhenSignedOut(): void {
  const kind = useSession((s) => s.kind);
  const navigate = useNavigate();
  const wasGoogle = useRef(kind === 'google');
  useEffect(() => {
    if (kind === 'google') {
      wasGoogle.current = true;
      return;
    }
    if (!wasGoogle.current) return;
    wasGoogle.current = false;
    navigate('/', { replace: true });
  }, [kind, navigate]);
}

/** Receipts for the signed-in person, for as long as the layout is mounted. */
function useReceiptsListener(): void {
  const uid = useSession((s) => (s.kind === 'google' ? s.user?.uid : undefined));
  useEffect(() => (uid ? useReceipts.getState().start('real', uid) : undefined), [uid]);
}

export function MainLayout() {
  useLeaveWhenSignedOut();
  useReceiptsListener();
  const google = useSession((s) => s.kind === 'google' && !s.ownerConflict);
  const { pathname } = useLocation();
  const setup = pathname === '/setup';

  return (
    <div className={styles.shell}>
      <header className={styles.rail}>
        <Link to="/ask" className={styles.brand}>
          {APP_NAME}
        </Link>
        {setup ? null : <MainNav />}
      </header>
      <div className={styles.content}>
        <OfflineBanner />
        <main id="main" tabIndex={-1} className={styles.main}>
          {google ? (
            <Suspense fallback={null}>
              <GmailAccess />
            </Suspense>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
