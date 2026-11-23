// AskHome (the final design, F2): the page before a question. A small headline and lead in the middle of the page,
// quiet rows for notices, whatever the screen adds (the Playground's "What is on this computer" row), then at the
// bottom the suggestion chips and the prompt card. The two ribbons sit behind, clipped so nothing scrolls sideways.
// The Ask page leaves the card out (it keeps the card in its own dock at the bottom of the window) and sets
// --home-min, so the home fills only the space above that dock.
import { Fragment, type ReactNode } from 'react';
import { Glyph } from './glyphs';
import styles from './AskHome.module.css';

export interface AskChip {
  label: string;
  selected?: boolean;
  onClick(): void;
}

export interface AskHomeProps {
  headlineLines: readonly string[];
  lead: string;
  notices?: ReactNode;
  /** The prompt card; null keeps its place empty (the Playground while it sets up), undefined leaves it out. */
  card?: ReactNode;
  chipsLabel: string;
  chips: AskChip[];
  children?: ReactNode;
  footer?: ReactNode;
}

export function AskHome({ headlineLines, lead, notices, card, chipsLabel, chips, children, footer }: AskHomeProps) {
  return (
    <div className={styles.home}>
      <div className={styles.ribbons} aria-hidden="true">
        <div className={`ribbon ${styles.ribbonLeft}`} />
        <div className={`ribbon ribbon--second ${styles.ribbonRight}`} />
      </div>
      <div className={styles.hero}>
        <h1 className={styles.headline}>
          {/* One line per span; the space between them keeps the heading's name a sentence for screen readers. */}
          {headlineLines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 ? ' ' : null}
              <span className={styles.headlineLine}>{line}</span>
            </Fragment>
          ))}
        </h1>
        <p className={styles.lead}>{lead}</p>
      </div>
      {notices ? <div className={styles.notices}>{notices}</div> : null}
      {children}
      {chips.length > 0 ? (
        <div className={styles.chipsBlock}>
          <p className={styles.chipsLabel}>{chipsLabel}</p>
          <div className={styles.chips}>
            {chips.map((chip) => (
              <button key={chip.label} type="button" className={styles.chip} aria-pressed={chip.selected ?? false} onClick={chip.onClick}>
                <Glyph name="sparkle" size={14} className={styles.chipGlyph} />
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {/* The question box sits at the bottom of the page, like the field of a chat (Nov 22, 2026). */}
      {card !== undefined ? <div className={styles.cardSlot}>{card}</div> : null}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}
