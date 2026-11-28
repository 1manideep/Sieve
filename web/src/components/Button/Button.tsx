// Button and LinkButton (40 section 16.1). Button forwards its ref so screens can move focus to it.
// Final design: every button is a pill. primary = white with black text (the public screens), tone="blue" turns
// primary into #1B6EF3 with white text (Approve-type actions in the app), secondary = outline, ghost = blue text.
import { forwardRef, type ButtonHTMLAttributes, type MouseEventHandler, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../icons';
import { Spinner } from '../Spinner/Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonTone = 'default' | 'blue';
export type ButtonSize = 'md' | 'sm' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size?: ButtonSize;               // md: 15px, 44px tall; sm: 14px, 40px tall; lg: 16px, 52px tall
  tone?: ButtonTone;               // blue: #1B6EF3 with white text (primary only)
  busy?: boolean;                  // 16px spinner before the label, aria-busy; label unchanged
  icon?: IconName;
}

function classes(variant: ButtonVariant, size: ButtonSize, tone: ButtonTone, extra?: string): string {
  return [styles.button, styles[variant], styles[size], tone === 'blue' ? styles.blue : '', extra].filter(Boolean).join(' ');
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
  { variant, size = 'md', tone = 'default', busy, icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button {...rest} ref={ref} type={type} className={classes(variant, size, tone, className)} aria-busy={busy || undefined}>
      <Inner busy={busy} icon={icon}>{children}</Inner>
    </button>
  );
});

export interface LinkButtonProps extends Omit<ButtonProps, 'type' | 'onClick'> {
  to: string;
  external?: boolean;
  /** A same-origin file to save rather than open: a plain link with the download attribute, not the router's. */
  download?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/** A router Link styled as a button, an external link opened in a new tab, or a file to download. Forwards its ref like Button. */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { to, external, download, variant, size = 'md', tone = 'default', busy, icon, className, children, id, onClick },
  ref,
) {
  const cls = classes(variant, size, tone, className);
  if (download) {
    return (
      <a ref={ref} href={to} download className={cls} id={id} onClick={onClick}>
        <Inner busy={busy} icon={icon}>{children}</Inner>
      </a>
    );
  }
  if (external) {
    return (
      <a ref={ref} href={to} target="_blank" rel="noopener" className={cls} id={id} onClick={onClick}>
        <Inner busy={busy} icon={icon}>{children}</Inner>
      </a>
    );
  }
  return (
    <Link ref={ref} to={to} className={cls} id={id} onClick={onClick}>
      <Inner busy={busy} icon={icon}>{children}</Inner>
    </Link>
  );
});
