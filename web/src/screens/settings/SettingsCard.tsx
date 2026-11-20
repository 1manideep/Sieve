// A Settings section (40 section 13.8; F5): a plain H2 with tabIndex -1 for hash links, the save status and actions
// at its right, then the content in one small glass box, or, with `bare`, rows that are glass themselves. Wrapped
// in the component-level error boundary (7.8).
import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import kit from './kit/kit.module.css';
import styles from './settings.module.css';

export interface SettingsCardProps {
  id: string;
  title: string;
  status?: string;
  actions?: ReactNode;
  bare?: boolean;
  children: ReactNode;
}

export function SettingsCard({ id, title, status, actions, bare = false, children }: SettingsCardProps) {
  const headingId = `${id}-heading`;
  return (
    <ErrorBoundary>
      <section id={id} className={styles.card} aria-labelledby={headingId}>
        <div className={styles.cardHeader}>
          <h2 id={headingId} className={styles.cardTitle} tabIndex={-1}>
            {title}
          </h2>
          {status || actions ? (
            <div className={styles.cardRight}>
              {status ? (
                <span className={styles.saveStatus} role="status">
                  {status}
                </span>
              ) : null}
              {actions}
            </div>
          ) : null}
        </div>
        {bare ? children : <div className={`${kit.glassSm} ${styles.cardBody}`}>{children}</div>}
      </section>
    </ErrorBoundary>
  );
}
