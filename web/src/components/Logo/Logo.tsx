// Shield logo and wordmark (40 sections 7.2 and 15.7).
import { Link } from 'react-router-dom';
import { APP_NAME } from '@/copy/strings';
import { Icon } from '../icons';
import styles from './Logo.module.css';

export interface LogoProps {
  /** Link target; omit for a plain (non-link) logo. */
  to?: string;
  size?: 'header' | 'splash';
}

export function Logo({ to, size = 'header' }: LogoProps) {
  const content = (
    <>
      <Icon name="shield" size={size === 'splash' ? 40 : 28} className={styles.mark} />
      <span className={styles.wordmark}>{APP_NAME}</span>
    </>
  );
  const className = `${styles.logo} ${size === 'splash' ? styles.splash : ''}`;
  if (to === undefined) return <span className={className}>{content}</span>;
  return (
    <Link to={to} className={className}>
      {content}
    </Link>
  );
}
