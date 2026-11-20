// Tag (40 section 16.1): a small pill whose tone follows the colour language of 15.3. Text always carries the meaning.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import styles from './Tag.module.css';

export type TagTone = 'device' | 'device-code' | 'cloud' | 'warn' | 'never' | 'muted';

export interface TagProps {
  tone: TagTone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

const TONE: Record<TagTone, string> = {
  device: styles.device,
  'device-code': styles.deviceCode,
  cloud: styles.cloud,
  warn: styles.warn,
  never: styles.never,
  muted: styles.muted,
};

export function Tag({ tone, icon, children, className }: TagProps) {
  return (
    <span className={[styles.tag, TONE[tone], className].filter(Boolean).join(' ')} data-tone={tone}>
      {icon ? <Icon name={icon} size={16} className={styles.icon} /> : null}
      <span className={styles.text}>{children}</span>
    </span>
  );
}
