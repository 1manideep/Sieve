// ItemSummary (40 section 16.9): the item a proposal is about, as the found-item chip of the final design: an icon
// for its kind, the title, then "From: {name} · {date}" (or the date), the category and the rule, and "Open on this
// device". For a 'never' item only the title and category show, because no model read it.
import type { CategoryRule, ItemKind, Proposal } from '@sieve/shared';
import { ITEM_COPY } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { CategoryBadge } from '../CategoryBadge/CategoryBadge';
import { Glyph, type GlyphName } from '../AskResult/glyphs';
import { Fill } from '../Fill/Fill';
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

const KIND_ICON: Record<ItemKind, GlyphName> = { email: 'mail', document: 'file', photo: 'photo', note: 'file' };

/** "Gmail", "Local folder"…: the source named by the record id's prefix ("gmail:…"), or nothing for an unknown one. */
export function sourceLabel(recordId: string): string | undefined {
  const prefix = recordId.split(':', 1)[0] as keyof typeof ITEM_COPY.sources;
  return Object.hasOwn(ITEM_COPY.sources, prefix) ? ITEM_COPY.sources[prefix] : undefined;
}

export function ItemSummary({ item, rule, reason, onOpen, compact = false, minimal = false }: ItemSummaryProps) {
  const date = formatDate(item.date);
  const source = sourceLabel(item.recordId);
  return (
    <div className={`${styles.summary} ${compact ? styles.compact : ''} ${minimal ? styles.minimal : ''}`}>
      <Glyph name={KIND_ICON[item.kind]} size={18} className={styles.icon} />
      <div className={styles.text}>
        <h2 className={styles.title} dir="auto">
          {item.title}
        </h2>
        <p className={styles.meta}>
          {minimal ? null : (
            <span className={styles.metaItem}>
              {item.kind === 'email' && item.from ? (
                <Fill template={ITEM_COPY.from} values={{ name: senderName(item.from), date }} />
              ) : (
                date
              )}
            </span>
          )}
          {minimal ? null : <span className={styles.metaItem}>{ITEM_COPY.kinds[item.kind]}</span>}
          {minimal || !source ? null : <span className={styles.metaItem}>{source}</span>}
          <CategoryBadge category={item.category} rule={rule} />
        </p>
        {!minimal && reason ? (
          <p className={styles.reason}>
            <strong>{ITEM_COPY.why}</strong> <bdi>{reason}</bdi>
          </p>
        ) : null}
      </div>
      {!minimal && onOpen ? (
        <Button variant="ghost" size="sm" className={styles.open} onClick={onOpen}>
          {ITEM_COPY.open}
        </Button>
      ) : null}
    </div>
  );
}
