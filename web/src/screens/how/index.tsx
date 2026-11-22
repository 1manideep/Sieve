// /how, "How Sieve works" (F4 in docs/design/final-flow.md): the hero with the statement and the video card, then
// the white paper in one card with a sticky "On this page" rail beside it. Below 1040px the rail is hidden and a
// folded "On this page" list opens the paper instead. The words live in copy/screens-how.ts; this file lays them out.
// In-page links are router links, so ScrollRestoration scrolls to the section instead of undoing the jump.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { env } from '@/app/env';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { LinkButton } from '@/components/Button/Button';
import { HOW_COPY, HOW_SECTIONS, type HowBlock, type HowCell, type HowListItem, type HowTable } from '@/copy/screens-how';
import { SCREENS, TITLES } from '@/copy/strings';
import { ArchitectureFigure, LadderFigure, RelayFigure, StepsFigure } from './figures';
import styles from './how.module.css';

/** The explainer video. While it is null the card is a still placeholder; set it to the video's URL and the card
 *  opens the video in a new tab, without the "coming soon" chip. */
export const HOW_VIDEO_URL: string | null = null;

const SECTION_IDS = HOW_SECTIONS.map((s) => s.id);

const FIGURES = { architecture: ArchitectureFigure, steps: StepsFigure, ladder: LadderFigure, relay: RelayFigure };

/** The section being read: the first one that crosses the band from 10% to 30% down the window. */
export function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id);
          else seen.delete(entry.target.id);
        }
        const current = ids.find((id) => seen.has(id));
        if (current) setActive(current);
      },
      { rootMargin: '-10% 0px -70% 0px' },
    );
    for (const id of ids) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

/** The copy's **strong** and `code` marks as elements; the rest stays plain text. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
        part.startsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith('`') ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function List({ items, ordered }: { items: readonly HowListItem[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag>
      {items.map((item, i) => (
        <li key={i}>
          {typeof item === 'string' ? (
            <Rich text={item} />
          ) : (
            <>
              {item.text}
              <ul>
                {item.items.map((sub) => (
                  <li key={sub}>{sub}</li>
                ))}
              </ul>
            </>
          )}
        </li>
      ))}
    </Tag>
  );
}

function Cell({ cell }: { cell: HowCell }) {
  if (typeof cell === 'string') return <Rich text={cell} />;
  return (
    <>
      <span className={cell.tone ? `${styles.chip} ${styles[cell.tone]}` : styles.chip}>{cell.chip}</span>
      {cell.after}
    </>
  );
}

function Table({ table }: { table: HowTable }) {
  return (
    <div className={styles.scroll}>
      <table>
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            {table.head.map((head, i) => (
              <th key={i} scope="col">
                {head || <span className="visually-hidden">{HOW_COPY.number}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className={table.head[c] ? undefined : styles.num}>
                  <Cell cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ block }: { block: HowBlock }) {
  if ('p' in block) return <p><Rich text={block.p} /></p>;
  if ('h3' in block) return <h3>{block.h3}</h3>;
  if ('ul' in block) return <List items={block.ul} />;
  if ('ol' in block) return <List items={block.ol} ordered />;
  if ('table' in block) return <Table table={block.table} />;
  if ('note' in block) {
    return (
      <div className={styles.note}>
        <p><Rich text={block.note} /></p>
      </div>
    );
  }
  if ('figure' in block) {
    const Figure = FIGURES[block.figure];
    return <Figure />;
  }
  return (
    <div className={styles.next}>
      <LinkButton to="/playground" variant="primary">
        {HOW_COPY.playground}
      </LinkButton>
      <LinkButton to={env.repoUrl} external variant="secondary">
        {HOW_COPY.source}
      </LinkButton>
    </div>
  );
}

/** The video card: a still picture with a play mark and the title. A link only once the video exists. */
export function VideoCard({ url }: { url: string | null }) {
  const v = HOW_COPY.video;
  const inside = (
    <>
      <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <circle className={styles.ring} cx="320" cy="180" r="118" />
        <polyline points="70,84 214,150" />
        <polyline points="96,196 204,186" />
        <polyline points="78,292 220,226" />
        <polyline points="150,128 214,150" />
        <polyline points="160,250 220,226" />
        <circle cx="70" cy="84" r="3" />
        <circle cx="150" cy="128" r="2.4" />
        <circle cx="96" cy="196" r="3" />
        <circle cx="160" cy="250" r="2.4" />
        <circle cx="78" cy="292" r="3" />
        <text x="58" y="68">{v.mail}</text>
        <text x="50" y="216">{v.files}</text>
        <text x="62" y="314">{v.photos}</text>
        <line className={styles.out} x1="442" y1="180" x2="548" y2="180" />
        <circle className={styles.blue} cx="560" cy="180" r="5" />
        <circle className={styles.halo} cx="560" cy="180" r="12" />
        <text className={styles.blue} x="560" y="212" textAnchor="middle">{v.line}</text>
      </svg>
      <span className={styles.over}>
        <span className={styles.play} aria-hidden="true" />
        <span className={styles.title}>{v.title}</span>
        {url ? null : <span className={`${styles.chip} ${styles.soon}`}>{v.soon}</span>}
      </span>
    </>
  );
  if (url) {
    return (
      <a className={styles.video} href={url} target="_blank" rel="noopener noreferrer">
        {inside}
      </a>
    );
  }
  return (
    <div className={styles.video} role="img" aria-label={v.label}>
      {inside}
    </div>
  );
}

function Contents({ active }: { active?: string }) {
  return (
    <ol>
      {HOW_SECTIONS.map(({ id, title }) => (
        <li key={id}>
          <Link to={`#${id}`} aria-current={id === active ? 'location' : undefined}>
            {title}
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function HowScreen() {
  const active = useActiveSection(SECTION_IDS);
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <h1>{SCREENS.how.heading}</h1>
          <p className={styles.lead}>{HOW_COPY.lead}</p>
          <p className={styles.status}>{HOW_COPY.status}</p>
        </div>
        <VideoCard url={HOW_VIDEO_URL} />
      </div>

      <div className={styles.frame}>
        <article className={styles.paper}>
          <details className={styles.toc}>
            <summary className={styles.label}>{HOW_COPY.onThisPage}</summary>
            <Contents />
          </details>
          {HOW_SECTIONS.map((section) => (
            <section key={section.id} id={section.id}>
              <h2>{section.title}</h2>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </section>
          ))}
        </article>

        <nav className={styles.rail} aria-label={HOW_COPY.onThisPage}>
          <p className={styles.label}>{HOW_COPY.onThisPage}</p>
          <Contents active={active} />
        </nav>
      </div>
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.how);
  return <HowScreen />;
}
