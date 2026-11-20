// The page under the opening (design canvas, Main board): typographic, hairlines between rows, no cards.
import { Link } from 'react-router-dom';
import styles from './landing.module.css';

const REPO = 'https://github.com/1manideep/Sieve';

export function MainPage() {
  return (
    <>
      <section className={styles.section}>
        <p className={styles.statement}>
          Sieve sits between your email, files and photos and the AI assistants you use. A model on your own computer finds the one item a question needs and writes the answer. You see exactly what would leave, and only what you approve goes out.
        </p>
        <div className={styles.meta}>
          <span>Gemini Nano on the device</span><span>Gemini in the cloud for drafts</span><span>Firebase AI Logic</span><span>Open source, Apache-2.0</span>
        </div>
      </section>

      <section id="how" className={`${styles.section} ${styles.sectionTight}`}>
        <p className={styles.eyebrow}>How it works</p>
        <div className={styles.step}>
          <span className={styles.stepNo}>01</span>
          <div className={styles.stepBody}>
            <h2 className={styles.h2}>The need-to-know ladder</h2>
            <p className={styles.text}>Answer, excerpt, or the whole item. Sieve starts at the smallest step. You can always go lower, never higher than the assistant was allowed.</p>
          </div>
          <div className={styles.rows}>
            <div className={styles.row}><span>1 · Answer</span><span className={styles.mono}>44 characters</span></div>
            <div className={styles.row}><span className={styles.dim}>2 · Excerpt</span><span className={styles.mono}>212 characters</span></div>
            <div className={styles.row}><span className={styles.dim}>3 · Full email</span><span className={styles.mono}>1,480 characters</span></div>
          </div>
        </div>
        <div className={styles.step}>
          <span className={styles.stepNo}>02</span>
          <div className={styles.stepBody}>
            <h2 className={styles.h2}>What has AI seen?</h2>
            <p className={styles.text}>Every share leaves a receipt: who asked, what, which step, which item, when, who approved. Never the content.</p>
          </div>
          <div className={styles.rows}>
            <div className={styles.row}><span>Gemini CLI asked about the deposit</span><span className={styles.mono}>answer · today</span></div>
            <div className={styles.row}><span>Gemini asked about the flight</span><span className={styles.mono}>excerpt · Mon</span></div>
            <div className={styles.row}><span>Gemini CLI asked about test results</span><span className={styles.blocked}>blocked</span></div>
          </div>
        </div>
        <div className={`${styles.step} ${styles.stepLast}`}>
          <span className={styles.stepNo}>03</span>
          <div className={styles.stepBody}>
            <h2 className={styles.h2}>A trace in two lanes</h2>
            <p className={styles.text}>Under every answer: what ran on this computer, what ran in the cloud, and how many characters crossed between them, as the SDK reports it.</p>
          </div>
          <div className={styles.lanes}>
            <div className={styles.lane}>
              <span className={`${styles.laneTitle} ${styles.laneDevice}`}>This device</span>
              <span>Search 46 items · 32 ms</span><span>Pick and answer · 9.4 s</span><span>Redact · 3 ms</span>
            </div>
            <div className={styles.lane}>
              <span className={`${styles.laneTitle} ${styles.laneCloud}`}>Cloud</span>
              <span>Draft a reply · 1.8 s</span><span style={{ color: '#C4B5FD' }}>44 characters crossed</span><span className={styles.dim}>nothing else</span>
            </div>
          </div>
        </div>
      </section>

      <section id="relay" className={`${styles.section} ${styles.two}`}>
        <div className={styles.stack}>
          <p className={styles.eyebrow}>Outside assistants</p>
          <h2 className={styles.h2Big}>Gemini in the cloud asks. Gemini Nano on your device decides what it gets.</h2>
          <p className={styles.textWide}>Any assistant that supports MCP connectors gets a link with a Ratchet grant: which steps it may ask for, which categories, until when. Every answer still waits for your approval, in the app or in the Chrome side panel.</p>
          <p className={styles.note}>Works with Gemini CLI and other MCP clients.</p>
        </div>
        <div className={styles.relayRows}>
          <div className={styles.relayRow}><span className={`${styles.laneTitle} ${styles.laneCloud}`}>cloud</span><span>sieve_answer {'{'} question: "What did my landlord say about the deposit?", from: "landlord" {'}'}</span></div>
          <div className={styles.relayRow}><span className={`${styles.laneTitle} ${styles.laneDevice}`}>device</span><span>46 items searched, one chosen, the answer written, personal details masked</span></div>
          <div className={styles.relayRow}><span className={`${styles.laneTitle} ${styles.laneYou}`}>you</span><span>Approve the answer, 44 characters</span></div>
          <div className={styles.relayRow}><span className={`${styles.laneTitle} ${styles.laneCloud}`}>cloud</span><span>"Your deposit was $1,200, paid on March 3."</span></div>
        </div>
      </section>

      <section id="extension" className={`${styles.section} ${styles.two}`}>
        <div className={styles.col}>
          <h2 className={styles.h2}>Approve from any tab</h2>
          <p className={styles.textWide}>The Chrome extension is a thin side panel next to whatever you are doing. It talks only to your Sieve tab, on this computer. Control+Shift+S opens it.</p>
          <div className={styles.links}><a className={styles.underline} href={`${REPO}#extension`}>Get the extension</a></div>
        </div>
        <div id="playground" className={styles.col}>
          <h2 className={styles.h2}>No Gemini Nano on your machine?</h2>
          <p className={styles.textWide}>The Playground runs on sample data with cloud answers while the model downloads. Or use Sieve on a real Mac with Nano ready, streamed to your browser: one of two seats, about 15 minutes.</p>
          <div className={styles.links}>
            <Link className={styles.underline} to="/playground">Open the Playground</Link>
            <Link className={styles.underline} to="/try">Try it on a real computer</Link>
          </div>
        </div>
      </section>

      <footer id="video" className={styles.footer}>
        <span>Sieve · Built for #BuildHybridAI 2026 with Firebase AI Logic · 3D scene made with Spline, after work by heyvlad and waldo (CC BY 4.0)</span>
        <div className={styles.links}>
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}#privacy`}>Privacy</a>
          <a href="#top">Back to top</a>
        </div>
      </footer>
    </>
  );
}
