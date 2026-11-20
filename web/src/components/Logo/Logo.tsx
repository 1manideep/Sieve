// The name as text, no mark: "Sieve" in Google Sans 500 (docs/design/final-flow.md).
import { Link } from 'react-router-dom';
import { APP_NAME } from '@/copy/strings';
import styles from './Logo.module.css';

export interface LogoProps {
  /** Link target; omit for a plain (non-link) logo. */
  to?: string;
  size?: 'header' | 'splash';
}

export function Logo({ to, size = 'header' }: LogoProps) {
  const className = `${styles.logo} ${size === 'splash' ? styles.splash : ''}`;
  if (to === undefined) return <span className={className}>{APP_NAME}</span>;
  return (
    <Link to={to} className={className}>
      {APP_NAME}
    </Link>
  );
}
