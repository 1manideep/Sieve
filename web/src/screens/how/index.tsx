// /how, F4 in docs/design/final-flow.md: what happens to your data. 46 dashes stand for the items on this computer;
// Run walks through the four steps (searched, picked, answered here, approved) and the counters follow. Nothing here
// talks to a model: it is the same story with fixed numbers, told one step at a time.
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button/Button';
import { Icon } from '@/components/icons';
import { HOW_COPY } from '@/copy/screens-main';
import { SCREENS, TITLES } from '@/copy/strings';
import styles from './how.module.css';

export type Step = 0 | 1 | 2 | 3 | 4;

interface Dash { x: number; y: number; r: number; c: string }

/** The board's stage is 1440 x 640; dash positions are in those units and drawn as percentages. */
const STAGE_W = 1440;
const STAGE_H = 640;
const DASH_W = 22;
const DASH_H = 7;
export const DASH_COUNT = 46;
export const CHOSEN = 17;
const COLORS = ['#FFFFFF', '#8AB4F8', '#C2D7FE', '#1B6EF3', '#FFFFFF'] as const;

/** The board's seeded dashes (seed 23, Lehmer LCG): the same field on every visit. The chosen one is blue. */
export function makeDashes(): Dash[] {
  let seed = 23;
  const rnd = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const dashes: Dash[] = [];
  for (let i = 0; i < DASH_COUNT; i++) {
    const x = Math.round(60 + rnd() * 1300);
    const y = Math.round(20 + rnd() * 580);
    dashes.push({ x, y, r: Math.round(rnd() * 180), c: COLORS[i % COLORS.length] ?? '#FFFFFF' });
  }
  dashes[CHOSEN] = { x: 300, y: 316, r: 20, c: '#8AB4F8' };
  return dashes;
}

const DASHES = makeDashes();

const pctX = (x: number) => `${((x / STAGE_W) * 100).toFixed(3)}%`;
const pctY = (y: number) => `${((y / STAGE_H) * 100).toFixed(3)}%`;

function Field({ step }: { step: Step }) {
  return (
    <div className={styles.field} aria-hidden="true" data-testid="dashes">
      {DASHES.map((d, i) => {
        const chosen = i === CHOSEN;
        const opacity = step === 0 ? (chosen ? 1 : 0.85) : chosen ? 1 : step >= 4 ? 0.18 : 0.26;
        const scale = step >= 1 && chosen ? 1.8 : 1;
        return (
          <span
            key={i}
            className={styles.dash}
            data-chosen={chosen || undefined}
            style={{
              left: pctX(d.x + DASH_W / 2),
              top: pctY(d.y + DASH_H / 2),
              background: d.c,
              opacity,
              transform: `translate(-50%, -50%) rotate(${d.r}deg) scale(${scale})`,
            }}
          />
        );
      })}
      {step >= 1 ? <span className={styles.ring} style={{ left: pctX(310), top: pctY(320) }} /> : null}
    </div>
  );
}

export function HowScreen() {
  const [step, setStep] = useState<Step>(0);
  const approveRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const advance = () => {
    if (step === 3) {
      // "Approve to continue": the choice is the card's Approve button, so take the focus there.
      approveRef.current?.focus();
      return;
    }
    setStep(step === 4 ? 0 : ((step + 1) as Step));
  };
  const back = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/welcome');
  };

  const read = step >= 2 ? '1' : '0';
  const left = step >= 4 ? '44' : '0';

  return (
    <div className={styles.page}>
      <div className={`ribbon ${styles.ribbon}`} aria-hidden="true" />

      <div className={styles.bar}>
        <div className={styles.titleRow}>
          <button type="button" className={styles.back} onClick={back}>
            <Icon name="arrow-left" size={18} />
            <span className="visually-hidden">{HOW_COPY.back}</span>
          </button>
          <div className={styles.titles}>
            <h1 className={styles.eyebrow}>{SCREENS.how.heading}</h1>
            <p className={styles.question}>{HOW_COPY.question}</p>
          </div>
        </div>
        <div className={styles.controls}>
          <span className={styles.stepLabel}>{HOW_COPY.stepLabels[step]}</span>
          <Button variant="primary" size="lg" className={styles.run} onClick={advance}>
            {HOW_COPY.runLabels[step]}
          </Button>
        </div>
      </div>

      <section className={styles.stage} aria-label={HOW_COPY.stageLabel}>
        <div className={styles.fieldWrap}>
          <Field step={step} />
          {step >= 1 ? (
            <span className={styles.matched} style={{ left: `calc(${pctX(310)} + 35px)`, top: pctY(320) }}>
              {HOW_COPY.matched}
            </span>
          ) : null}
        </div>

        <div className={styles.flow}>
          {step >= 2 ? (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.cardTitle}>
                  <span className={styles.cardMark} aria-hidden="true" />
                  <span className={styles.cardName}>{HOW_COPY.itemTitle}</span>
                </span>
                <span>{HOW_COPY.itemMeta}</span>
              </div>
              {step === 2 ? <p className={styles.reading}>{HOW_COPY.reading}</p> : null}
              {step >= 3 ? (
                <>
                  <p className={styles.sentence}>{HOW_COPY.sentence}</p>
                  <div className={styles.cardFoot}>
                    <span className={styles.meta}>{HOW_COPY.sentenceMeta}</span>
                    {step === 3 ? (
                      <Button ref={approveRef} variant="primary" tone="blue" size="sm" onClick={() => setStep(4)}>
                        {HOW_COPY.approve}
                      </Button>
                    ) : (
                      <span className={styles.approved}>
                        <span className={styles.okDot} aria-hidden="true" />
                        {HOW_COPY.approved}
                      </span>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {step >= 4 ? (
            <>
              <div className={styles.cross}>
                <span className={styles.crossLine} aria-hidden="true" />
                <span className={styles.crossLabel}>{HOW_COPY.cross}</span>
              </div>
              <div className={styles.cloud}>
                <span className={styles.cloudTitle}>{HOW_COPY.cloudTitle}</span>
                <span className={styles.cloudBody}>{HOW_COPY.cloudBody}</span>
              </div>
              <span className={styles.stayed}>{HOW_COPY.stayed}</span>
            </>
          ) : null}
        </div>
      </section>

      <div className={styles.footer}>
        <p className={styles.caption} aria-live="polite">
          {HOW_COPY.captions[step]}
        </p>
        <ul className={styles.counters} aria-label={HOW_COPY.countersLabel}>
          <li className={styles.counter}>
            <span className={styles.value}>46</span>
            <span className={styles.counterCaption}>{HOW_COPY.searched}</span>
          </li>
          <li className={styles.counter}>
            <span className={styles.value}>{read}</span>
            <span className={styles.counterCaption}>{HOW_COPY.readByModel}</span>
          </li>
          <li className={styles.counter}>
            <span className={`${styles.value} ${styles.valueBlue}`}>{left}</span>
            <span className={styles.counterCaption}>{HOW_COPY.left}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.how);
  return <HowScreen />;
}
