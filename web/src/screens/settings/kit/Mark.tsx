// One bare mark in a row of marks (Settings' assistants, Sources' sources): the glyph, the name and a short line
// under it, grey while it is off. Pressing it opens its panel in place under the row; aria-pressed says which is open.
import type { ReactNode } from 'react';
import ground from './ground.module.css';

export interface MarkProps {
  glyph: ReactNode;
  name: string;
  sub: string;
  /** Grey: an assistant with no connection, a source that is not connected. */
  off?: boolean;
  pressed: boolean;
  onPress(): void;
}

export function Mark({ glyph, name, sub, off = false, pressed, onPress }: MarkProps) {
  return (
    <li>
      <button type="button" className={off ? `${ground.mark} ${ground.markOff}` : ground.mark} aria-pressed={pressed} onClick={onPress}>
        <span className={ground.markGlyph}>{glyph}</span>
        <span className={ground.markName}>{name}</span>
        <span className={ground.markSub}>{sub}</span>
      </button>
    </li>
  );
}
