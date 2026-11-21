// SourcesGrid (40 section 13.6; design handoff of Nov 20, 2026): what is in the index, as a grid. Categories go
// down, sources go across, and every cell holds a circle sized by its count (ringed in the never colour when the
// category is never shared). A row opens in place with its newest items, where they came from and its rule. The
// counts come from the index's keys; the senders from its newest items; nothing here leaves this computer.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, type Category, type CategoryRule } from '@sieve/shared';
import { LinkButton } from '@/components/Button/Button';
import { CATEGORY_COLORS, CategoryIcon } from '@/components/CategoryIcon/CategoryIcon';
import { Segmented } from '@/components/Segmented/Segmented';
import { SETTINGS, SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import type { SieveDb } from '@/index';
import ground from '../settings/kit/ground.module.css';
import { formatDate } from '../settings/kit/when';
import { LineIcon, SOURCE_ICONS } from './sourceIcons';
import { REAL_SOURCES, senderName, useFrequentSenders, useNewestItems, type CategorySplit, type RealSource } from './sourcesDb';
import styles from './sources.module.css';

type Sort = 'size' | 'rule' | 'name';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'size', label: SOURCES.sortSize },
  { value: 'rule', label: SOURCES.sortRule },
  { value: 'name', label: SOURCES.sortName },
];
const RULE_ORDER: Record<CategoryRule, number> = { never: 0, 'ask-first': 1, approve: 2 };
const RULE_LABEL: Record<CategoryRule, string> = { approve: SETTINGS.ruleApprove, 'ask-first': SETTINGS.ruleAskFirst, never: SETTINGS.ruleNever };
/** The circle's radius for a count: the square root, so the area follows the count, between 4.5 and 27 px. */
export function radius(n: number): number {
  return n <= 0 ? 0 : Math.max(4.5, Math.min(27, 4 + Math.sqrt(n) * 0.5));
}

function RuleChip({ rule }: { rule: CategoryRule }) {
  return <span className={`${styles.rulechip} ${rule === 'ask-first' ? styles.ask : rule === 'never' ? styles.never : ''}`}>{RULE_LABEL[rule]}</span>;
}

/** The words of the search, marked where a title holds them. */
function marked(text: string, q: string): ReactNode {
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className={styles.hit}>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

function Cell({ n, name, color, never, delay }: { n: number; name: string; color: string; never: boolean; delay: number }) {
  if (n <= 0) {
    return (
      <span className={styles.cell}>
        <span className={styles.none} aria-hidden="true" />
        <span className="visually-hidden">{`${name}: ${SOURCES.cellNone}`}</span>
      </span>
    );
  }
  const r = radius(n);
  const box = (r + 6) * 2;
  return (
    <span className={styles.cell}>
      <svg width={box} height={box} viewBox={`${-(r + 6)} ${-(r + 6)} ${box} ${box}`} aria-hidden="true">
        <g className={styles.dot} style={{ transitionDelay: `${delay}ms` }}>
          {never ? <circle r={r + 4} fill="none" stroke="#F28B82" strokeWidth="1.6" /> : null}
          <circle r={r} fill={color} />
        </g>
      </svg>
      <span className={styles.cnt}>
        <span className="visually-hidden">{`${name}: `}</span>
        {formatCount(n)}
      </span>
    </span>
  );
}

function OpenRow({ db, category, rule, counts, total, q }: { db: SieveDb | null; category: Category; rule: CategoryRule; counts: Record<RealSource, number>; total: number; q: string }) {
  const items = useNewestItems(db, category, true);
  const from = REAL_SOURCES.filter((k) => counts[k] > 0)
    .map((k) => `${SOURCES.names[k]} ${formatCount(counts[k])}`)
    .join(' · ');
  return (
    <div id={`category-${category}`} role="region" aria-label={category} className={`${ground.open} ${styles.open}`}>
      {items === undefined ? (
        <span />
      ) : items.length === 0 ? (
        <p className={ground.metaLine}>{SOURCES.categoryEmpty}</p>
      ) : (
        <ul className={styles.items}>
          {items.map((it) => {
            const photo = it.kind === 'photo' && Boolean(it.caption);
            const who = photo ? it.title : it.from ? senderName(it.from) : undefined;
            return (
              <li key={it.id} className={styles.it}>
                <span className={rule === 'never' ? `${styles.itDot} ${styles.itRing}` : styles.itDot} style={rule === 'never' ? undefined : { background: CATEGORY_COLORS[category] }} aria-hidden="true" />
                <bdi className={styles.itTitle}>{marked(photo ? (it.caption ?? it.title) : it.title, q)}</bdi>
                <span className={styles.itMeta}>
                  {who ? <bdi>{who}</bdi> : null}
                  {`${who ? ' · ' : ''}${SOURCES.names[it.source]} · ${formatDate(it.date)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className={ground.openCol}>
        <dl className={styles.facts}>
          <dt className={ground.label}>{SOURCES.openFrom}</dt>
          <dd>{from}</dd>
          <dt className={ground.label}>{SOURCES.openRule}</dt>
          <dd>
            <RuleChip rule={rule} /> {SOURCES.ruleSentence[rule]}
          </dd>
          <dt className={ground.label}>{SOURCES.openReadBy}</dt>
          <dd>{rule === 'never' ? SOURCES.readByNever : SOURCES.readBy}</dd>
        </dl>
        <p className={ground.metaLine}>{fillText(SOURCES.showing, { n: formatCount(items?.length ?? 0), total: formatCount(total) })}</p>
        <div className={ground.actions}>
          <LinkButton to="/ask" variant="secondary" size="sm">
            {SOURCES.askAbout}
          </LinkButton>
          <Link to="/settings#rules" className={styles.link}>
            {SOURCES.changeRule}
          </Link>
        </div>
      </div>
    </div>
  );
}

export interface SourcesGridProps {
  db: SieveDb | null;
  split?: CategorySplit;
  sourceCounts?: Record<RealSource, number>;
  rules: Record<Category, CategoryRule>;
}

export function SourcesGrid({ db, split, sourceCounts, rules }: SourcesGridProps) {
  const [sort, setSort] = useState<Sort>('size');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Category | null>(null);
  // The circles start at nothing and grow in, row by row; Play does it again.
  const [settling, setSettling] = useState(true);
  const senders = useFrequentSenders(db);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettling(false), 350);
    return () => window.clearTimeout(timer);
  }, []);
  const play = () => {
    setSettling(true);
    window.setTimeout(() => setSettling(false), 80);
  };

  const q = query.trim().toLowerCase();
  const totalOf = (c: Category) => REAL_SOURCES.reduce((n, k) => n + (split?.[c][k] ?? 0), 0);
  const order = [...CATEGORIES].sort((a, b) =>
    sort === 'size' ? totalOf(b) - totalOf(a) : sort === 'rule' ? RULE_ORDER[rules[a]] - RULE_ORDER[rules[b]] || totalOf(b) - totalOf(a) : a.localeCompare(b),
  );
  const matches = (c: Category) => !q || c.toLowerCase().includes(q) || (senders?.[c] ?? []).some((name) => name.toLowerCase().includes(q));
  const all = REAL_SOURCES.reduce((n, k) => n + (sourceCounts?.[k] ?? 0), 0);

  return (
    <section className={ground.sec} aria-labelledby="sources-grid-heading">
      <div className={ground.secHead}>
        <h2 id="sources-grid-heading" className={ground.h2}>
          {SOURCES.gridHeading}
        </h2>
        <p className={ground.secNote}>{SOURCES.gridNote}</p>
      </div>
      <div className={styles.toolbar}>
        <Segmented<Sort> label={SOURCES.sortLabel} options={SORTS} value={sort} onChange={setSort} />
        <label className={`${ground.search} ${styles.gridSearch}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <span className="visually-hidden">{SOURCES.gridSearchLabel}</span>
          <input type="search" value={query} placeholder={SOURCES.gridSearchPlaceholder} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className={styles.iconButton} aria-label={SOURCES.play} title={SOURCES.play} onClick={play}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 4.5l12 7.5-12 7.5z" />
          </svg>
        </button>
      </div>

      <div className={settling ? `${styles.grid} ${styles.settling}` : styles.grid}>
        <div className={`${styles.gcols} ${styles.ghead}`} aria-hidden="true">
          <span className={ground.label}>{SOURCES.colCategory}</span>
          {REAL_SOURCES.map((k) => (
            <span key={k} className={styles.src}>
              <LineIcon d={SOURCE_ICONS[k]} size={20} />
              <span className={styles.srcName}>{SOURCES.names[k]}</span>
            </span>
          ))}
          <span className={`${ground.label} ${styles.whoCol}`}>{SOURCES.colFrom}</span>
          <span className={`${ground.label} ${styles.ruleCol}`}>{SOURCES.colRule}</span>
        </div>
        {order.map((c, i) => {
          const rule = rules[c];
          const names = senders?.[c] ?? [];
          const total = totalOf(c);
          const isOpen = open === c;
          return (
            <div key={c}>
              <button
                type="button"
                className={`${styles.gcols} ${styles.grow} ${matches(c) ? '' : styles.dim}`}
                aria-expanded={isOpen}
                aria-controls={`category-${c}`}
                onClick={() => setOpen(isOpen ? null : c)}
              >
                <span className={styles.cat}>
                  <CategoryIcon category={c} size={22} never={rule === 'never'} />
                  <span className={styles.nm}>
                    <span>{c}</span>
                    <span>
                      {fillText(SOURCES.itemCount, { n: formatCount(total) })}
                      {rule === 'never' ? ` · ${SOURCES.rowNever}` : rule === 'ask-first' ? ` · ${SOURCES.rowAsk}` : ''}
                    </span>
                  </span>
                </span>
                {REAL_SOURCES.map((k, j) => (
                  <Cell key={k} n={split?.[c][k] ?? 0} name={SOURCES.names[k]} color={CATEGORY_COLORS[c]} never={rule === 'never'} delay={(i * 3 + j) * 45} />
                ))}
                <span className={`${styles.who} ${styles.whoCol}`}>
                  {names.length > 0 ? names.map((name) => <bdi key={name}>{marked(name, q)}</bdi>) : <span className={styles.em}>{SOURCES.noOne}</span>}
                </span>
                <span className={`${styles.rule} ${styles.ruleCol}`}>
                  <RuleChip rule={rule} />
                </span>
              </button>
              {isOpen ? <OpenRow db={db} category={c} rule={rule} counts={split?.[c] ?? { gmail: 0, folder: 0, upload: 0 }} total={total} q={q} /> : null}
            </div>
          );
        })}
        <div className={`${styles.gcols} ${styles.gfoot}`}>
          <span className={ground.label}>{SOURCES.allOfIt}</span>
          {REAL_SOURCES.map((k) => (
            <span key={k} className={styles.footCell}>
              <span className="visually-hidden">{`${SOURCES.names[k]}: `}</span>
              {formatCount(sourceCounts?.[k] ?? 0)}
            </span>
          ))}
          <span className={styles.whoCol} />
          <span className={`${styles.footCell} ${styles.footTotal}`}>{formatCount(all)}</span>
        </div>
      </div>

      <p className={styles.legend} aria-hidden="true">
        <span>
          <span className={ground.swatch} style={{ background: '#A8C7FA' }} />
          {SOURCES.legendCircle}
        </span>
        <span>
          <span className={`${ground.swatch} ${styles.legendRing}`} />
          {SOURCES.legendNever}
        </span>
        <span>
          <span className={styles.none} />
          {SOURCES.legendNone}
        </span>
      </p>
    </section>
  );
}
