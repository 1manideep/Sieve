// Chip (40 section 16.1): a pill button for suggestions and filters. Ask uses the teal "on" style, the Playground
// and filters the inverse one. The selected chip reports aria-pressed.
import type { ReactNode } from 'react';
import styles from './Chip.module.css';

export interface ChipProps {
  selected?: boolean;
  selectedStyle?: 'device' | 'inverse';
  onClick(): void;
  children: ReactNode;
  shape?: 'pill' | 'rounded';      // Playground suggestions use radius 14px
}

export function Chip({ selected = false, selectedStyle = 'device', onClick, children, shape = 'pill' }: ChipProps) {
  const cls = [
    styles.chip,
    shape === 'rounded' ? styles.rounded : '',
    selected ? (selectedStyle === 'inverse' ? styles.onInverse : styles.onDevice) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}
