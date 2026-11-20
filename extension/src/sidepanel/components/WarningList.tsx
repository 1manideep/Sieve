// Warnings below the outgoing text (50 section 8.5), in the app's order and with the app's titles (shared copy).
// The clean line ("No hidden instructions flagged on this device") sits in the meta row of OutgoingText.
import { WARNING_ORDER } from '@sieve/shared';
import type { Category, Warning } from '@sieve/shared';
import { warningHeading, warningTone } from '../../shared/labels';
import s from '../ui.module.css';

export function hasInjectionWarning(warnings: Warning[]): boolean {
  return warnings.some((w) => w.kind === 'injection' || w.kind === 'hidden-text-removed');
}

export function WarningList({ warnings, category }: { warnings: Warning[]; category?: Category }) {
  if (warnings.length === 0) return null;
  const ordered = [...warnings].sort((a, b) => WARNING_ORDER.indexOf(a.kind) - WARNING_ORDER.indexOf(b.kind));
  return (
    <ul className={s.warningList}>
      {ordered.map((w, i) => {
        const title = warningHeading(w, category);
        return (
          <li key={`${w.kind}-${i}`} className={`${s.warning} ${warningTone(w.kind) === 'cloud' ? s.warningCloud : s.warningWarn}`}>
            {title ? <strong className={s.warningTitle}>{title}</strong> : null}
            <span className={s.warningMessage} dir="auto">
              {w.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
