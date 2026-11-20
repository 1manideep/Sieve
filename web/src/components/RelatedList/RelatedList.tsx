// RelatedList (40 section 16.10): items that might also matter. Suggested, never shared unless ticked.
import { useState } from 'react';
import type { Candidate } from '@sieve/shared';
import type { RecordMeta } from '@/state/records';
import { RELATED_COPY } from '@/copy/screens-main';
import { formatRelative } from '../TimeText/TimeText';
import styles from './RelatedList.module.css';

export interface RelatedListProps {
  variant: 'aside' | 'list';                     // in-app aside | relay left column
  mainId?: string;                               // relay: the main item, shown first, checked and disabled
  related: Candidate[];
  meta: Record<string, RecordMeta | null>;
  selected: string[];
  loading: string[];
  errors?: Record<string, string>;
  onToggle(id: string): void;
  disabled?: boolean;
  headingless?: boolean;                         // inside a disclosure that already names the list
  now?: number;
}

function Row({
  id, meta, reason, checked, disabled, loading, error, main, onToggle, now,
}: {
  id: string; meta: RecordMeta | null | undefined; reason?: string; checked: boolean; disabled: boolean;
  loading: boolean; error?: string; main: boolean; onToggle(id: string): void; now: number;
}) {
  const title = meta?.title ?? RELATED_COPY.missingTitle;
  const line = [meta ? formatRelative(meta.date, now) : null, reason].filter(Boolean).join(' · ');
  return (
    <li className={`${styles.row} ${checked ? styles.ticked : ''}`} data-record={id}>
      <label className={styles.labelRow}>
        <input
          type="checkbox"
          className={styles.box}
          checked={checked}
          disabled={disabled || loading || main}
          aria-disabled={disabled || undefined}
          onChange={() => onToggle(id)}
        />
        <span className={styles.text}>
          <span className={styles.title} dir="auto">
            {title}
          </span>
          {line ? (
            <span className={styles.line} dir="auto">
              {line}
            </span>
          ) : null}
          {main ? <span className={styles.line}>{RELATED_COPY.bestMatch}</span> : null}
          {loading ? <span className={styles.line}>{RELATED_COPY.preparing}</span> : null}
          {error ? <span className={styles.error}>{RELATED_COPY.error}</span> : null}
        </span>
      </label>
    </li>
  );
}

export function RelatedList({
  variant, mainId, related, meta, selected, loading, errors = {}, onToggle, disabled = false, headingless = false, now: nowProp,
}: RelatedListProps) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  if (variant === 'aside' && related.length === 0) return null;
  const Heading = variant === 'aside' ? 'h3' : 'h2';
  return (
    <section className={`${styles.related} ${styles[variant]}`} aria-label={variant === 'aside' ? RELATED_COPY.asideTitle : RELATED_COPY.listTitle}>
      {headingless ? null : (
        <div className={styles.head}>
          <Heading className={styles.heading}>{variant === 'aside' ? RELATED_COPY.asideTitle : RELATED_COPY.listTitle}</Heading>
          <p className={styles.sub}>{variant === 'aside' ? RELATED_COPY.asideSub : RELATED_COPY.listSub}</p>
        </div>
      )}
      <ul className={styles.rows}>
        {variant === 'list' && mainId ? (
          <Row id={mainId} meta={meta[mainId]} checked disabled loading={false} main onToggle={onToggle} now={now} />
        ) : null}
        {related.map((c) => (
          <Row
            key={c.recordId}
            id={c.recordId}
            meta={meta[c.recordId]}
            reason={c.reason}
            checked={selected.includes(c.recordId)}
            disabled={disabled}
            loading={loading.includes(c.recordId)}
            error={errors[c.recordId]}
            main={false}
            onToggle={onToggle}
            now={now}
          />
        ))}
      </ul>
    </section>
  );
}
