// Under 768px: a dismissible notice at the top (40 section 15.4). Nothing is hidden.
import { useEffect, useState } from 'react';
import { SHELL } from '@/copy/strings';
import { Icon } from '../icons';
import styles from './NarrowNotice.module.css';

const QUERY = '(max-width: 767px)';

function matches(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

export function NarrowNotice() {
  const [narrow, setNarrow] = useState(matches);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(QUERY);
    const onChange = () => setNarrow(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);

  if (!narrow || dismissed) return null;
  return (
    <div className={styles.notice}>
      <p className={styles.text}>{SHELL.narrowNotice}</p>
      <button type="button" className={styles.dismiss} aria-label={SHELL.dismiss} onClick={() => setDismissed(true)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
