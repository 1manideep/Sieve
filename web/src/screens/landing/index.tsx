// Landing (`/landing`): the opening with the Spline sieve, then the page. Design canvas "Sieve landing, dark".
import { useEffect } from 'react';
import { MainPage } from './MainPage';
import { Opening } from './Opening';
import styles from './landing.module.css';

export function Component() {
  useEffect(() => {
    document.title = 'Sieve: give AI the answer, not your inbox';
  }, []);
  return (
    <div className={styles.page}>
      <Opening />
      <MainPage />
    </div>
  );
}
