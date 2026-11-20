// CategoryList (40 section 13.6; F5): one disclosure per category with its count and rule in a glass card;
// expanded, the five newest titles from the real index.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, type Category, type CategoryRule } from '@sieve/shared';
import { CategoryBadge } from '@/components/CategoryBadge/CategoryBadge';
import { Icon } from '@/components/icons';
import { SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import type { SieveDb } from '@/index';
import kit from '../settings/kit/kit.module.css';
import { useNewestTitles } from './sourcesDb';
import styles from './sources.module.css';

export interface CategoryListProps {
  db: SieveDb | null;
  counts?: Record<Category, number>;
  rules: Record<Category, CategoryRule>;
}

export function CategoryList({ db, counts, rules }: CategoryListProps) {
  return (
    <section className={`${kit.glass} ${styles.categoriesCard}`} aria-labelledby="categories-heading">
      <div>
        <h2 id="categories-heading" className={styles.cardTitle}>
          {SOURCES.categoriesHeading}
        </h2>
        <p className={styles.meta}>{SOURCES.categoriesSub}</p>
      </div>
      <ul className={styles.categories}>
        {CATEGORIES.map((c) => (
          <CategoryRow key={c} db={db} category={c} count={counts?.[c] ?? 0} rule={rules[c]} />
        ))}
      </ul>
      <Link to="/settings#rules" className={styles.link}>
        {SOURCES.changeRules}
      </Link>
    </section>
  );
}

function CategoryRow({ db, category, count, rule }: { db: SieveDb | null; category: Category; count: number; rule: CategoryRule }) {
  const [open, setOpen] = useState(false);
  const titles = useNewestTitles(db, category, open);
  const panelId = `category-${category}`;
  return (
    <li className={styles.categoryRow}>
      <div className={styles.categoryHead}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
          <span className={styles.categoryName}>{category}</span>{' '}
          <span className={styles.categoryCount}>{fillText(SOURCES.categoryCount, { n: formatCount(count) })}</span>
        </button>
        <CategoryBadge category={category} rule={rule} />
      </div>
      <div id={panelId} hidden={!open} className={styles.categoryPanel}>
        {open && titles !== undefined ? (
          titles.length === 0 ? (
            <p className={styles.meta}>{SOURCES.categoryEmpty}</p>
          ) : (
            <ul className={styles.titles}>
              {titles.map((t, i) => (
                <li key={i} dir="auto">
                  {t}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </li>
  );
}
