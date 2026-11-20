// EmptyState (40 section 16.1): an icon, a title, one sentence and optional actions.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body: string;
  actions?: ReactNode;
}

export function EmptyState({ icon, title, body, actions }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} size={24} className={styles.icon} />
      <p className={styles.title}>{title}</p>
      <p className={styles.body}>{body}</p>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
