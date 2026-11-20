// Inline SVG icons (40 section 15.9). Decorative: meaning is always in the adjacent text.
import type { ReactElement } from 'react';

export type IconName =
  | 'shield' | 'warning' | 'device' | 'cloud' | 'code' | 'person' | 'ban' | 'check' | 'copy'
  | 'chevron-right' | 'chevron-down' | 'close' | 'info' | 'clock' | 'disk';

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
};

export interface IconProps {
  name: IconName;
  size?: 16 | 20 | 22 | 24 | 28 | 40;
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
