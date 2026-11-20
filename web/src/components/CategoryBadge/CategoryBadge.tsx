// CategoryBadge (40 section 16.2): the category and its rule, as tags.
import type { Category, CategoryRule } from '@sieve/shared';
import { CATEGORY_COPY, fill } from '@/copy/screens-main';
import { Tag, type TagTone } from '../Tag/Tag';
import styles from './CategoryBadge.module.css';

export interface CategoryBadgeProps {
  category: Category;
  rule: CategoryRule;
  mode?: 'badge' | 'rule-line';
}

const RULE_TONE: Record<CategoryRule, TagTone> = { approve: 'device', 'ask-first': 'warn', never: 'never' };

export function categoryRuleLine(category: Category, rule: CategoryRule): string {
  return fill(CATEGORY_COPY.ruleLine[rule], { category });
}

export function CategoryBadge({ category, rule, mode = 'badge' }: CategoryBadgeProps) {
  if (mode === 'rule-line') {
    return <Tag tone={RULE_TONE[rule]}>{categoryRuleLine(category, rule)}</Tag>;
  }
  return (
    <span className={styles.badge}>
      <Tag tone="muted">{category}</Tag>
      {rule === 'ask-first' ? <Tag tone="warn">{CATEGORY_COPY.askFirst}</Tag> : null}
      {rule === 'never' ? <Tag tone="never">{CATEGORY_COPY.never}</Tag> : null}
    </span>
  );
}
