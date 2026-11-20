// ReceiptFilters (40 section 13.7): AI toggles, then Source and When selects. Pure view over useReceipts.filters.
import { useId } from 'react';
import { Chip } from '@/components/Chip/Chip';
import { SEEN } from '@/copy/screens-controls';
import { useReceipts, type ReceiptFilters as Filters } from '@/state/receipts';
import styles from './seen.module.css';

const SOURCE_OPTIONS: { value: Filters['source']; label: string }[] = [
  { value: 'all', label: SEEN.sourceAll },
  { value: 'gmail', label: SEEN.sourceGmail },
  { value: 'folder', label: SEEN.sourceFolder },
  { value: 'upload', label: SEEN.sourceUpload },
];

const RANGE_OPTIONS: { value: Filters['range']; label: string }[] = [
  { value: 'any', label: SEEN.rangeAny },
  { value: 'today', label: SEEN.rangeToday },
  { value: '7d', label: SEEN.range7d },
  { value: '30d', label: SEEN.range30d },
];

export function ReceiptFilters({ ais, filters }: { ais: string[]; filters: Filters }) {
  const showId = useId();
  const sourceId = useId();
  const whenId = useId();
  const set = useReceipts.getState().setFilter;
  return (
    <div className={styles.filters}>
      <div className={styles.aiGroup} role="group" aria-labelledby={showId}>
        <span id={showId} className={styles.filterLabel}>
          {SEEN.show}
        </span>
        <Chip selected={filters.ai === 'all'} selectedStyle="inverse" onClick={() => set('ai', 'all')}>
          {SEEN.all}
        </Chip>
        {ais.map((name) => (
          <Chip key={name} selected={filters.ai === name} selectedStyle="inverse" onClick={() => set('ai', name)}>
            <bdi>{name}</bdi>
          </Chip>
        ))}
      </div>
      <div className={styles.selectWrap}>
        <label htmlFor={sourceId} className={styles.filterLabel}>
          {SEEN.sourceLabel}
        </label>
        <select
          id={sourceId}
          className={styles.select}
          value={filters.source}
          onChange={(e) => set('source', e.target.value as Filters['source'])}
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.selectWrap}>
        <label htmlFor={whenId} className={styles.filterLabel}>
          {SEEN.whenLabel}
        </label>
        <select
          id={whenId}
          className={styles.select}
          value={filters.range}
          onChange={(e) => set('range', e.target.value as Filters['range'])}
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
