import type { CategoryRule, ProposalPreview } from '@sieve/shared';
import { itemMeta, ruleTag } from '../../shared/labels';
import s from '../ui.module.css';
import { Tag } from './Basics';

export function ItemSummary({ item, rule }: { item: NonNullable<ProposalPreview['item']>; rule: CategoryRule }) {
  return (
    <div className={s.item}>
      <p className={s.itemTitle} dir="auto">
        {item.title}
      </p>
      <p className={s.meta}>{itemMeta(item)}</p>
      {rule === 'ask-first' ? <Tag tone="warn">{ruleTag('ask-first', item.category)}</Tag> : null}
      {rule === 'never' ? <Tag tone="never">{ruleTag('never', item.category)}</Tag> : null}
    </div>
  );
}
