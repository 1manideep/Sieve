// WarningBanner and WarningList (40 section 16.6). Titles come from shared/src/copy.ts so the extension uses the
// same words; the body is the pipeline's warning message.
import { WARNING_ORDER, warningTitle, type Category, type Warning, type WarningKind } from '@sieve/shared';
import { WARNING_COPY } from '@/copy/screens-main';
import type { IconName } from '../icons';
import { Notice, type NoticeTone } from '../Notice/Notice';
import { Tag } from '../Tag/Tag';
import styles from './WarningBanner.module.css';

const LOOK: Record<WarningKind, { tone: NoticeTone; icon: IconName }> = {
  injection: { tone: 'warning', icon: 'warning' },
  'hidden-text-removed': { tone: 'warning', icon: 'warning' },
  'ask-first': { tone: 'warning', icon: 'warning' },
  'cloud-fallback': { tone: 'cloud', icon: 'cloud' },
  'sample-data-cloud': { tone: 'cloud', icon: 'cloud' },
  'pii-redacted': { tone: 'info', icon: 'shield' },
  'pii-check-limited': { tone: 'warning', icon: 'info' },
  'unverified-answer': { tone: 'warning', icon: 'warning' },
  'source-unchecked': { tone: 'warning', icon: 'info' },
};

export interface WarningBannerProps {
  warning: Warning;
  category?: Category;
}

export function WarningBanner({ warning, category }: WarningBannerProps) {
  const look = LOOK[warning.kind];
  const title = warningTitle(warning.kind, category) ?? undefined;
  return (
    <div data-warning={warning.kind}>
      <Notice tone={look.tone} icon={look.icon} title={title}>
        <p dir="auto">{warning.message}</p>
      </Notice>
    </div>
  );
}

export interface WarningListProps {
  warnings: Warning[];
  category?: Category;
  showCleanCheck: boolean;   // the trace has an 'injection' step
}

/**
 * The order of 40 section 16.6, except that 'ask-first' goes last: the list sits directly above the decision buttons
 * "so an ask-first warning is the last thing read before approving".
 */
export function sortWarnings(warnings: Warning[]): Warning[] {
  const rank = (k: Warning['kind']) => (k === 'ask-first' ? WARNING_ORDER.length : WARNING_ORDER.indexOf(k));
  return [...warnings].sort((a, b) => rank(a.kind) - rank(b.kind));
}

export function WarningList({ warnings, category, showCleanCheck }: WarningListProps) {
  const sorted = sortWarnings(warnings);
  const clean = showCleanCheck && !warnings.some((w) => w.kind === 'injection' || w.kind === 'hidden-text-removed');
  if (sorted.length === 0 && !clean) return null;
  return (
    <div className={styles.list}>
      {clean ? (
        <div>
          <Tag tone="device" icon="check">
            {WARNING_COPY.cleanCheck}
          </Tag>
        </div>
      ) : null}
      {sorted.map((w, i) => (
        <WarningBanner key={`${w.kind}-${i}`} warning={w} category={category} />
      ))}
    </div>
  );
}
