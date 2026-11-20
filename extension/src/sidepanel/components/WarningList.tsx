// Warnings below the outgoing text (50 section 8.5), in the app's order and with the app's titles (shared copy).
import { WARNING_ORDER } from '@sieve/shared';
import type { Category, Warning } from '@sieve/shared';
import { COPY, warningHeading, warningTone } from '../../shared/labels';
import s from '../ui.module.css';
import { Tag } from './Basics';

export function hasInjectionWarning(warnings: Warning[]): boolean {
  return warnings.some((w) => w.kind === 'injection' || w.kind === 'hidden-text-removed');
}

export function WarningList({ warnings, category }: { warnings: Warning[]; category?: Category }) {
  const ordered = [...warnings].sort((a, b) => WARNING_ORDER.indexOf(a.kind) - WARNING_ORDER.indexOf(b.kind));
  return (
    <div className={s.warnings}>
      {ordered.length > 0 ? (
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
      ) : null}
      {hasInjectionWarning(warnings) ? null : <Tag tone="device">{COPY.cleanTag}</Tag>}
    </div>
  );
}
