// Button and LinkButton (40 section 16.1). Button forwards its ref so screens can move focus to it.
import { forwardRef, type ButtonHTMLAttributes, type MouseEventHandler, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../icons';
import { Spinner } from '../Spinner/Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size?: 'md' | 'sm';              // md: 15px 600, padding 12px 18px; sm: 14px 600, padding 10px 14px; both min height 44px, radius 12px
  busy?: boolean;                  // 16px spinner before the label, aria-busy; label unchanged
  icon?: IconName;
}

function classes(variant: ButtonVariant, size: 'md' | 'sm', extra?: string): string {
  return [styles.button, styles[variant], styles[size], extra].filter(Boolean).join(' ');
}

function Inner({ busy, icon, children }: { busy?: boolean; icon?: IconName; children?: ReactNode }) {
  return (
    <>
      {busy ? <Spinner size={16} labelled={false} /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size = 'md', busy, icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button {...rest} ref={ref} type={type} className={classes(variant, size, className)} aria-busy={busy || undefined}>
      <Inner busy={busy} icon={icon}>{children}</Inner>
    </button>
  );
});

export interface LinkButtonProps extends Omit<ButtonProps, 'type' | 'onClick'> {
  to: string;
  external?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/** A router Link styled as a button, or an external link opened in a new tab. */
export function LinkButton({ to, external, variant, size = 'md', busy, icon, className, children, id, onClick }: LinkButtonProps) {
  const cls = classes(variant, size, className);
  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener" className={cls} id={id} onClick={onClick}>
        <Inner busy={busy} icon={icon}>{children}</Inner>
      </a>
    );
  }
  return (
    <Link to={to} className={cls} id={id} onClick={onClick}>
      <Inner busy={busy} icon={icon}>{children}</Inner>
    </Link>
  );
}
