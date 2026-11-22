// The four figures of /how. Figures 1, 2 and 4 are SVG drawn on fixed view boxes (940, 800 and 800 wide); their marks
// are styled in how.module.css, so the elements here carry only geometry. Figure 3 is three HTML slips. The words come
// from copy/screens-how.ts.
import { Fragment, type ReactNode } from 'react';
import { HOW_COPY } from '@/copy/screens-how';
import styles from './how.module.css';

const F = HOW_COPY.figures;

function Figure({ caption, inner = styles.scroll, children }: { caption: readonly [string, string]; inner?: string; children: ReactNode }) {
  return (
    <figure>
      <div className={inner}>{children}</div>
      <figcaption>
        <b>{caption[0]}</b> {caption[1]}
      </figcaption>
    </figure>
  );
}

/** Two arrowheads per figure: `{id}a` for the white lines, `{id}b` (blue) for the approved text. */
function Arrows({ id, size }: { id: string; size: number }) {
  return (
    <defs>
      <marker id={`${id}a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={size} markerHeight={size} orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" />
      </marker>
      <marker id={`${id}b`} className={styles.am} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" />
      </marker>
    </defs>
  );
}

/** Figure 1's boxes as [x, y, width]; each is 60 tall, in the order of the copy's boxes. */
const ARCH_BOXES = [
  [36, 96, 150],
  [36, 244, 150],
  [236, 244, 150],
  [426, 244, 112],
  [692, 244, 100],
  [816, 244, 96],
] as const;

export function ArchitectureFigure() {
  const f = F.architecture;
  return (
    <Figure caption={f.caption}>
      <svg viewBox="0 0 940 372" role="img" aria-label={f.label}>
        <Arrows id="how-f1" size={7} />
        <rect className={styles.zd} x="16" y="36" width="540" height="320" rx="14" />
        <rect className={styles.zc} x="676" y="36" width="248" height="320" rx="14" />
        <text className={styles.b} x="34" y="62">{f.device}</text>
        <text className={styles.b} x="694" y="62">{f.cloud}</text>
        {ARCH_BOXES.map(([x, y, w], i) => (
          <Fragment key={x + y}>
            <rect x={x} y={y} width={w} height="60" rx="8" />
            <text className={styles.b} x={x + w / 2} y={y + 26} textAnchor="middle">{f.boxes[i]?.[0]}</text>
            <text className={styles.s} x={x + w / 2} y={y + 45} textAnchor="middle">{f.boxes[i]?.[1]}</text>
          </Fragment>
        ))}
        <line x1="111" y1="156" x2="111" y2="242" markerEnd="url(#how-f1a)" />
        <text className={styles.s} x="121" y="204">{f.indexed}</text>
        <line x1="186" y1="274" x2="234" y2="274" markerEnd="url(#how-f1a)" />
        <text className={styles.s} x="211" y="326" textAnchor="middle">{f.five}</text>
        <line x1="386" y1="274" x2="424" y2="274" markerEnd="url(#how-f1a)" />
        <text className={styles.s} x="406" y="326" textAnchor="middle">{f.sentence}</text>
        <polyline points="742,244 742,180 311,180 311,242" markerEnd="url(#how-f1a)" />
        <text x="616" y="172" textAnchor="middle">{f.question}</text>
        <line className={styles.la} x1="538" y1="274" x2="560" y2="274" />
        <rect className={styles.ra} x="560" y="261" width="112" height="26" rx="13" />
        <text className={styles.ta} x="616" y="278" textAnchor="middle">{f.approved}</text>
        <line className={styles.la} x1="672" y1="274" x2="690" y2="274" markerEnd="url(#how-f1b)" />
        <line x1="816" y1="264" x2="794" y2="264" markerEnd="url(#how-f1a)" />
        <line x1="792" y1="286" x2="814" y2="286" markerEnd="url(#how-f1a)" />
      </svg>
    </Figure>
  );
}

/** Figure 2: the lane of each step (0 plain code, 1 the on-device model, 2 the person); steps are 48 apart. */
const LANES = [0, 1, 0, 0, 1, 0, 1, 0, 1, 2];
const laneX = (lane: number) => 171 + 240 * lane;
const stepY = (i: number) => 50 + 48 * i;

export function StepsFigure() {
  const f = F.steps;
  return (
    <Figure caption={f.caption}>
      <svg viewBox="0 0 800 590" role="img" aria-label={f.label}>
        <Arrows id="how-f2" size={6.5} />
        {f.lanes.map((name, lane) => (
          <Fragment key={name}>
            <rect className={lane === 1 ? styles.zd : styles.zc} x={56 + 240 * lane} y="8" width="230" height="524" rx="12" />
            <text className={styles.b} x={laneX(lane)} y="32" textAnchor="middle">{name}</text>
          </Fragment>
        ))}
        {f.steps.map((step, i) => {
          const lane = LANES[i] ?? 0;
          return (
            <Fragment key={step}>
              <text className={styles.s} x="30" y={stepY(i) + 22} textAnchor="middle">{i + 1}</text>
              <rect className={lane === 2 ? styles.ra : undefined} x={68 + 240 * lane} y={stepY(i)} width="206" height="34" rx="8" />
              <text x={laneX(lane)} y={stepY(i) + 22} textAnchor="middle">{step}</text>
            </Fragment>
          );
        })}
        {/* Each step to the next: straight down in the same lane, else down, across and down. */}
        {LANES.slice(1).map((to, i) => {
          const from = LANES[i] ?? 0;
          const y = stepY(i) + 34;
          const points = from === to ? `${laneX(from)},${y} ${laneX(to)},${y + 13}` : `${laneX(from)},${y} ${laneX(from)},${y + 7} ${laneX(to)},${y + 7} ${laneX(to)},${y + 13}`;
          return <polyline key={i} points={points} markerEnd="url(#how-f2a)" />;
        })}
        <line className={styles.la} x1="651" y1="516" x2="651" y2="549" markerEnd="url(#how-f2b)" />
        <rect className={styles.ra} x="536" y="551" width="230" height="30" rx="15" />
        <text className={styles.ta} x="651" y="570" textAnchor="middle">{f.leaves}</text>
      </svg>
    </Figure>
  );
}

export function LadderFigure() {
  const f = F.ladder;
  return (
    <Figure caption={f.caption} inner={styles.ladder}>
      {f.slips.map((slip) => (
        <div key={slip.title} className={styles.slip}>
          <h3>{slip.title}</h3>
          <p>{slip.cap}</p>
          <pre>
            {/* The masks ([name], [email], ...) in blue. */}
            {slip.text.split(/(\[[a-z]+\])/).map((part, i) => (i % 2 ? <span key={i} className={styles.mask}>{part}</span> : part))}
          </pre>
        </div>
      ))}
    </Figure>
  );
}

/** Figure 4: the centre of each actor's lifeline, and each message as [label x, arrow y, from x, to x]. */
const ACTORS = [100, 300, 520, 700];
const MESSAGES = [
  [200, 98, 100, 298],
  [360, 138, 300, 518],
  [610, 228, 520, 698],
  [610, 268, 700, 522],
  [360, 308, 520, 302],
  [200, 348, 300, 102],
] as const;
const APPROVED = 4;

export function RelayFigure() {
  const f = F.relay;
  return (
    <Figure caption={f.caption}>
      <svg viewBox="0 0 800 432" role="img" aria-label={f.label}>
        <Arrows id="how-f4" size={6.5} />
        <rect className={styles.zd} x="420" y="8" width="364" height="416" rx="14" />
        <text className={styles.s} x="434" y="410">{f.device}</text>
        {ACTORS.map((x, i) => (
          <Fragment key={x}>
            <rect x={x - 60} y="22" width="120" height="34" rx="8" />
            <text className={styles.b} x={x} y="44" textAnchor="middle">{f.actors[i]}</text>
            <line className={styles.ld} x1={x} y1="56" x2={x} y2="388" />
          </Fragment>
        ))}
        {MESSAGES.map(([tx, y, x1, x2], i) => (
          <Fragment key={y}>
            <text className={i === 0 ? styles.mono : i === APPROVED ? styles.ta : undefined} x={tx} y={y - 8} textAnchor="middle">
              {f.messages[i]}
            </text>
            <line className={i === APPROVED ? styles.la : undefined} x1={x1} y1={y} x2={x2} y2={y} markerEnd={`url(#how-f4${i === APPROVED ? 'b' : 'a'})`} />
          </Fragment>
        ))}
        <rect x="432" y="160" width="176" height="30" rx="8" />
        <text x="520" y="180" textAnchor="middle">{f.work}</text>
        <text className={styles.s} x="300" y="408" textAnchor="middle">{f.kept}</text>
      </svg>
    </Figure>
  );
}
