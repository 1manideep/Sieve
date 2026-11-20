// Inline SVG icons (40 section 15.9). Decorative: meaning is always in the adjacent text.
import type { ReactElement } from 'react';

export type IconName =
  | 'shield' | 'warning' | 'device' | 'cloud' | 'code' | 'person' | 'ban' | 'check' | 'copy'
  | 'chevron-right' | 'chevron-down' | 'close' | 'info' | 'clock' | 'disk'
  | 'pencil' | 'monitor' | 'menu' | 'expand' | 'compress' | 'sparkle' | 'arrow-right' | 'arrow-left' | 'sidebar';

const SHAPES: Record<IconName, ReactElement> = {
  shield: (<><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  warning: (<><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><path d="M12 18h.01" /></>),
  device: (<><rect x={4} y={5} width={16} height={11} rx={2} /><path d="M2 19h20" /></>),
  cloud: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z" />,
  code: (<><path d="M8 8l-4 4 4 4" /><path d="M16 8l4 4-4 4" /></>),
  person: (<><circle cx={12} cy={8} r={4} /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>),
  ban: (<><circle cx={12} cy={12} r={9} /><path d="M5.6 5.6l12.8 12.8" /></>),
  check: <path d="M5 12l5 5 9-10" />,
  copy: (<><rect x={9} y={9} width={11} height={11} rx={2} /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>),
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  info: (<><circle cx={12} cy={12} r={9} /><path d="M12 11v5" /><path d="M12 8h.01" /></>),
  clock: (<><circle cx={12} cy={12} r={9} /><path d="M12 7v5l3 2" /></>),
  disk: (<><rect x={3} y={6} width={18} height={12} rx={2} /><path d="M7 14h.01" /></>),
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  monitor: (<><rect x={3} y={4} width={18} height={12} rx={2} /><path d="M8 20h8" /></>),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  compress: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  sparkle: <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  sidebar: (<><rect x={3} y={4} width={18} height={16} rx={2} /><path d="M9 4v16" /></>),
};

export interface IconProps {
  name: IconName;
  size?: 14 | 16 | 18 | 20 | 22 | 24 | 28 | 40;
  className?: string;
}

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
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
      {SHAPES[name]}
    </svg>
  );
}
