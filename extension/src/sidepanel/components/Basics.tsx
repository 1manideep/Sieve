// Small building blocks: the shield icon, tags and the visually hidden text helper.
import type { ReactNode } from 'react';
import s from '../ui.module.css';

export type TagTone = 'device' | 'cloud' | 'warn' | 'never' | 'muted';

const TONE_CLASS: Record<TagTone, string | undefined> = {
  device: s.tagDevice,
  cloud: s.tagCloud,
  warn: s.tagWarn,
  never: s.tagNever,
  muted: s.tagMuted,
};

export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return <span className={`${s.tag} ${TONE_CLASS[tone] ?? ''}`}>{children}</span>;
}

export function ShieldIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      className={s.shield}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3 L19 5.5 V11 C19 15.5 16 18.7 12 20 C8 18.7 5 15.5 5 11 V5.5 Z" />
      <path d="M9 11.5 L11.2 13.7 L15.5 9.4" />
    </svg>
  );
}

export function VisuallyHidden({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className={s.srOnly}>
      {children}
    </span>
  );
}
