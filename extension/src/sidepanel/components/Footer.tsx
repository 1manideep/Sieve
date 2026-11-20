import { COPY } from '../../shared/labels';
import s from '../ui.module.css';

/** "Open Sieve" asks the worker, which only focuses the Sieve tab or opens the app URL (50 section 8.8). */
export function Footer({ onOpenApp }: { onOpenApp(): void }) {
  return (
    <footer className={s.footer}>
      <button type="button" className={s.link} onClick={onOpenApp}>
        {COPY.openSieve}
      </button>
    </footer>
  );
}
