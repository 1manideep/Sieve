// Small building blocks: tags, the dotted-sphere glyph, the status dot and the visually hidden text helper.
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

/** The small dotted sphere from the boards (44 px, drawn in CSS). `off` is the dashed ring of "Sieve isn't open". */
export function Glyph({ dim = false, off = false }: { dim?: boolean; off?: boolean }) {
  return <span className={`${s.glyph} ${off ? s.glyphOff : ''} ${dim ? s.glyphDim : ''}`} aria-hidden="true" />;
}

export function VisuallyHidden({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className={s.srOnly}>
      {children}
    </span>
  );
}
