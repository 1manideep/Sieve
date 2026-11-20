// NoticeRow (the final design, F2): a notice above the prompt card as one quiet glass row: a status dot, the
// sentence, and its actions as small text links. Static (no role) unless it appears in response to something the
// person did; then it is a status region, like Notice.
import type { ReactNode } from 'react';
import styles from './NoticeRow.module.css';

export type NoticeRowTone = 'info' | 'warning' | 'cloud' | 'never' | 'success';

export interface NoticeRowProps {
  tone: NoticeRowTone;
  children: ReactNode;
  actions?: ReactNode;
  live?: boolean;
}

export function NoticeRow({ tone, children, actions, live = false }: NoticeRowProps) {
  return (
    <div className={styles.row} data-tone={tone} role={live ? 'status' : undefined}>
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.text}>{children}</div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
