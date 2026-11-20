// PublicLayout: Welcome, Prepare and Not found. A light header with the logo, then the main region.
import { Outlet } from 'react-router-dom';
import { Logo } from '@/components/Logo/Logo';
import styles from './PublicLayout.module.css';

export function PublicLayout() {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Logo to="/" />
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
