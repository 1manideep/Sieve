// The head of a control screen (docs/design/final-flow.md, F5): a plain h1 at 400 weight and the screen's actions
// on the right, then (with `tryNow`) the white "Try now" link to the demo computer. The rail with the screen names
// is MainLayout's, so there is no lead and no second title.
import type { ReactNode } from 'react';
import { LinkButton } from '@/components/Button/Button';
import { CONSOLE } from '@/copy/screens-controls';
import styles from './kit.module.css';

export interface ScreenHeadProps {
  title: string;
  actions?: ReactNode;
  /** The control screens end the row with the white "Try now" link to /try; first-run setup does not. */
  tryNow?: boolean;
}

export function ScreenHead({ title, actions, tryNow = false }: ScreenHeadProps) {
  return (
    <div className={styles.head}>
      <h1 className={styles.title}>{title}</h1>
      {actions || tryNow ? (
        <div className={styles.headActions}>
          {actions}
          {tryNow ? (
            <LinkButton to="/try" variant="primary" size="sm">
              {CONSOLE.tryNow}
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
