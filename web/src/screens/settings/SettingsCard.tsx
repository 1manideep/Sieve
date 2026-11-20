// A Settings card (40 section 13.8): white, H2 with tabIndex -1 for hash links, save status at the right of the
// header, wrapped in the component-level error boundary (7.8).
import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import styles from './settings.module.css';

export interface SettingsCardProps {
  id: string;
  title: string;
  status?: string;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

export function SettingsCard({ id, title, status, actions, wide, children }: SettingsCardProps) {
  const headingId = `${id}-heading`;
  return (
    <ErrorBoundary>
      <section id={id} className={wide ? `${styles.card} ${styles.wide}` : styles.card} aria-labelledby={headingId}>
        <div className={styles.cardHeader}>
          <h2 id={headingId} className={styles.cardTitle} tabIndex={-1}>
            {title}
          </h2>
          <div className={styles.cardRight}>
            {status ? (
              <span className={styles.saveStatus} role="status">
                {status}
              </span>
            ) : null}
            {actions}
          </div>
        </div>
        {children}
      </section>
    </ErrorBoundary>
  );
}
