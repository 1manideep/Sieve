// Footer (board F8): the shortcut in mono on the left, "Open Sieve" on the right. "Open Sieve" asks the worker,
// which only focuses the Sieve tab or opens the app URL (50 section 8.8). In the popup, a text button next to it,
// "Keep open on the side", moves Sieve into the side panel; the side panel itself never shows it.
import { COPY } from '../../shared/labels';
import { shortcutHint } from '../shortcut';
import s from '../ui.module.css';

export function Footer({ onOpenApp, onKeepOpen }: { onOpenApp(): void; onKeepOpen?: () => void }) {
  return (
    <footer className={s.footer}>
      <span className={s.shortcut}>{shortcutHint()}</span>
      <div className={s.footerActions}>
        {onKeepOpen ? (
          <button type="button" className={s.btnText} onClick={onKeepOpen}>
            {COPY.keepOpen}
          </button>
        ) : null}
        <button type="button" className={s.btnOutline} onClick={onOpenApp}>
          {COPY.openSieve}
        </button>
      </div>
    </footer>
  );
}
