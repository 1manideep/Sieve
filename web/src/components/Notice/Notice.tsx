// Notice (40 section 16.1): a banner with an icon, an optional title, text and actions. role="status" only when it
// appears in response to something the person did (live); static notices have no role.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import styles from './Notice.module.css';

export type NoticeTone = 'info' | 'warning' | 'cloud' | 'never' | 'success';

export interface NoticeProps {
  tone: NoticeTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
  live?: boolean;
  id?: string;
  compact?: boolean;   // 14px body (the Playground notes)
}

const DEFAULT_ICON: Record<NoticeTone, IconName> = {
  info: 'info',
  warning: 'warning',
  cloud: 'cloud',
  never: 'ban',
  success: 'check',
};

export function Notice({ tone, title, children, actions, icon, live = false, id, compact = false }: NoticeProps) {
  return (
    <div
      id={id}
      className={`${styles.notice} ${styles[tone]} ${compact ? styles.compact : ''}`}
      role={live ? 'status' : undefined}
      data-tone={tone}
    >
      <Icon name={icon ?? DEFAULT_ICON[tone]} size={22} className={styles.icon} />
      <div className={styles.content}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children ? <div className={styles.body}>{children}</div> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}
