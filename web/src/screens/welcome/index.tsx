// Welcome (`/welcome`), F1 in docs/design/final-flow.md: black, 120 twinkling stars, two still ribbons, the dotted
// sphere with the constellation (1,204 emails / 92 photos / 31 documents caught on it, one approved line out), the
// sentence, Open Sieve and Try on a real computer, three numbers in the footer. Initial focus stays on the document;
// the CTAs come first in tab order. Open Sieve signs in with Google (and honours ?next); on an error it stays here,
// with the error toast. Everyone uses their own data; the demo is "Try on a real computer".
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button, LinkButton } from '@/components/Button/Button';
import { useOpenSieve } from '@/components/useOpenSieve';
import { SCREENS, TITLES } from '@/copy/strings';
import { WELCOME_COPY } from '@/copy/screens-main';
import styles from './welcome.module.css';

interface Star { x: number; y: number; w: number; o: number; d: number; t: number }

/** The board's seeded stars (seed 7, Lehmer LCG): the same sky on every visit. */
export function makeStars(count: number, seed0: number): Star[] {
  let seed = seed0;
  const rnd = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const w = rnd() < 0.15 ? 3 : rnd() < 0.5 ? 2 : 1.5;
    stars.push({
      x: Math.round(rnd() * 1000) / 10,
      y: Math.round(rnd() * 1000) / 10,
      w,
      o: Math.round((0.35 + rnd() * 0.6) * 100) / 100,
      d: Math.round(rnd() * 80) / 10,
      t: Math.round((4 + rnd() * 5) * 10) / 10,
    });
  }
  return stars;
}

const STARS = makeStars(120, 7);

function Sky() {
  return (
    <div className={styles.sky} aria-hidden="true" data-testid="stars">
      {STARS.map((s, i) => (
        <span
          key={i}
          className={styles.star}
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.w, height: s.w, opacity: s.o, animationDelay: `${s.d}s`, animationDuration: `${s.t}s` }}
        />
      ))}
    </div>
  );
}

function Constellation() {
  const c = WELCOME_COPY.constellation;
  return (
    <svg className={styles.constellation} viewBox="0 0 1440 900" width="1440" height="900" aria-hidden="true" focusable="false">
      <g stroke="rgba(255,255,255,.38)" strokeWidth="1" fill="none">
        <line x1="150" y1="300" x2="470" y2="420" /><line x1="230" y1="540" x2="470" y2="420" /><line x1="190" y1="700" x2="450" y2="520" />
        <line x1="320" y1="420" x2="470" y2="420" /><line x1="280" y1="620" x2="450" y2="520" /><line x1="470" y1="420" x2="450" y2="520" />
      </g>
      <g stroke="rgba(255,255,255,.3)" strokeWidth="1" fill="none">
        <line x1="470" y1="420" x2="600" y2="330" /><line x1="600" y1="330" x2="760" y2="300" /><line x1="450" y1="520" x2="590" y2="610" />
        <line x1="590" y1="610" x2="760" y2="640" /><line x1="760" y1="300" x2="880" y2="380" /><line x1="760" y1="640" x2="880" y2="560" />
      </g>
      <line x1="470" y1="460" x2="1180" y2="460" stroke="#8AB4F8" strokeWidth="1.5" strokeDasharray="2 6" />
      <g fill="#FFFFFF">
        <circle cx="150" cy="300" r="3.5" /><circle cx="230" cy="540" r="3" /><circle cx="190" cy="700" r="3.5" /><circle cx="320" cy="420" r="2.5" /><circle cx="280" cy="620" r="2.5" />
        <circle cx="470" cy="420" r="3" /><circle cx="450" cy="520" r="3" /><circle cx="600" cy="330" r="2.5" /><circle cx="760" cy="300" r="2.5" /><circle cx="590" cy="610" r="2.5" />
        <circle cx="760" cy="640" r="2.5" /><circle cx="880" cy="380" r="2.5" /><circle cx="880" cy="560" r="2.5" />
      </g>
      <circle cx="1180" cy="460" r="6" fill="#8AB4F8" />
      <circle cx="1180" cy="460" r="16" fill="none" stroke="rgba(138,180,248,.6)" />
      <g fontFamily="'Google Sans Code', ui-monospace, monospace" fontSize="12" fill="rgba(255,255,255,.75)">
        <text x="140" y="286">{c.emails}</text>
        <text x="220" y="566">{c.photos}</text>
        <text x="180" y="726">{c.documents}</text>
        <text x="1206" y="464" fill="#8AB4F8">{c.line}</text>
      </g>
    </svg>
  );
}

export function WelcomeScreen() {
  const { openSieve, signingIn } = useOpenSieve();

  return (
    <div className={styles.stage}>
      <div className={`ribbon ${styles.ribbonA}`} aria-hidden="true" />
      <div className={`ribbon ribbon--second ${styles.ribbonB}`} aria-hidden="true" />
      <Sky />
      <div className={styles.scene} role="img" aria-label={WELCOME_COPY.sceneLabel}>
        <div className={styles.sphere} />
        <div className={styles.rim} />
        <Constellation />
      </div>

      <section className={styles.hero} aria-labelledby="welcome-title">
        <h1 id="welcome-title" className={styles.title}>
          {SCREENS.welcome.heading}
        </h1>
        <p className={styles.lead}>{SCREENS.welcome.lead}</p>
        <div className={styles.ctas}>
          <Button variant="primary" size="lg" busy={signingIn} disabled={signingIn} onClick={() => void openSieve()}>
            {WELCOME_COPY.openSieve}
          </Button>
          <LinkButton to="/try" variant="secondary" size="lg">
            {WELCOME_COPY.tryComputer}
          </LinkButton>
        </div>
        <p className={styles.note}>{WELCOME_COPY.signInNote}</p>
      </section>

      <footer className={styles.footer}>
        <ul className={styles.numbers} aria-label={WELCOME_COPY.numbersLabel}>
          {WELCOME_COPY.numbers.map((n, i) => (
            <li key={n.caption} className={styles.number}>
              <span className={i === 2 ? `${styles.value} ${styles.valueBlue}` : styles.value}>{n.value}</span>
              <span className={styles.caption}>{n.caption}</span>
            </li>
          ))}
        </ul>
        <p className={styles.built}>{WELCOME_COPY.built}</p>
      </footer>
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.welcome);
  return <WelcomeScreen />;
}
