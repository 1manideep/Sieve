// ItemSummary (40 section 16.9): the item a proposal is about. For a 'never' item only the title and category show,
// because no model read it.
import type { CategoryRule, Proposal } from '@sieve/shared';
import { ITEM_COPY } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { CategoryBadge } from '../CategoryBadge/CategoryBadge';
import { Fill } from '../Fill/Fill';
import { Tag } from '../Tag/Tag';
import { formatDate } from '../TimeText/TimeText';
import styles from './ItemSummary.module.css';

export interface ItemSummaryProps {
  item: NonNullable<Proposal['item']>;
  rule: CategoryRule;
  reason?: string;
  onOpen?(): void;
  compact?: boolean;
  minimal?: boolean;      // title and category only (rule 'never')
}

/** "Dana Whitfield <dana@...>" gives "Dana Whitfield"; a bare address stays as it is. */
export function senderName(from: string): string {
  const match = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(from);
  const name = match?.[1]?.trim();
  return name ? name : from.replace(/[<>]/g, '').trim();
}

export function ItemSummary({ item, rule, reason, onOpen, compact = false, minimal = false }: ItemSummaryProps) {
  const date = formatDate(item.date);
  return (
    <div className={`${styles.summary} ${compact ? styles.compact : ''}`}>
      {minimal ? (
        <div className={styles.tags}>
          <CategoryBadge category={item.category} rule={rule} />
        </div>
      ) : (
        <div className={styles.tags}>
          <Tag tone="device">{ITEM_COPY.found}</Tag>
          <Tag tone="muted">{ITEM_COPY.kinds[item.kind]}</Tag>
          <CategoryBadge category={item.category} rule={rule} />
        </div>
      )}
      <h2 className={styles.title} dir="auto">
        {item.title}
      </h2>
      {minimal ? null : (
        <p className={styles.meta}>
          {item.kind === 'email' && item.from ? (
            <Fill template={ITEM_COPY.from} values={{ name: senderName(item.from), date }} />
          ) : (
            date
          )}
        </p>
      )}
      {!minimal && reason ? (
        <p className={styles.reason}>
          <strong>{ITEM_COPY.why}</strong> <bdi>{reason}</bdi>
        </p>
      ) : null}
      {!minimal && onOpen ? (
        <div>
          <Button variant="ghost" size="sm" onClick={onOpen}>
            {ITEM_COPY.open}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

