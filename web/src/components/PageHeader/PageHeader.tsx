// PageHeader (40 sections 13 and 16.19): H1, a lead paragraph and optional actions.
import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  lead?: string;
  actions?: ReactNode;
  size?: 'ask' | 'page';
}

export function PageHeader({ title, lead, actions, size = 'page' }: PageHeaderProps) {
  return (
    <header className={`${styles.header} ${size === 'ask' ? styles.ask : ''}`}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {lead ? <p className={styles.lead}>{lead}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
