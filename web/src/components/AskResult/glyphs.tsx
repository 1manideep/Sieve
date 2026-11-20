// Small inline glyphs of the final design (the sparkle, the item kinds, the prompt card's controls). Decorative:
// the meaning is always in the adjacent text or the control's label.
import type { ReactElement } from 'react';

export type GlyphName = 'sparkle' | 'mail' | 'file' | 'photo' | 'plus' | 'mic' | 'arrow' | 'up' | 'chevron';

const FILLED: ReadonlySet<GlyphName> = new Set(['sparkle']);

const SHAPES: Record<GlyphName, ReactElement> = {
  sparkle: <path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z" />,
  mail: (<><rect x={3} y={5} width={18} height={14} rx={2} /><path d="M3 7l9 6 9-6" /></>),
  file: (<><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /></>),
  photo: (<><rect x={3} y={5} width={18} height={14} rx={2} /><circle cx={9} cy={10} r={1.6} /><path d="M21 16l-5-5-8 8" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  mic: (<><rect x={9} y={3} width={6} height={11} rx={3} /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  chevron: <path d="M6 9l6 6 6-6" />,
};

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  className?: string;
}

export function Glyph({ name, size = 16, className }: GlyphProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
