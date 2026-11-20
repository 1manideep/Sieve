// The opening (design canvas "Sieve landing, dark": Open board at 0 s, Name board at 2 s). A 1440 x 900 artboard
// scaled to cover the viewport. Items stream in from the left and are caught flat on the sieve; one thread leaves
// through the gap to the single answer on the right; then the name rises over the sieve and the nav fades in.
// The net, the items, the thread and the answer are the Spline scene (its own motion document drives them); this page
// adds the ground, the stream lines, the labels and the name. CSS keyframes here use `from` for the start pose and the
// base styles for the end pose, so reduced motion simply shows the finished frame.
import { createElement, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './landing.module.css';

export const SCENE_URL = 'https://prod.spline.design/qKWVr2j103MQ8egk/scene.splinecode';
const VIEWER_SRC = 'https://unpkg.com/@splinetool/viewer@2.0.194/build/spline-viewer.js';
/** The scene at rest (cards caught, the answer out), shown for reduced motion and while the scene loads. */
const STILL_SRC = '/landing/sieve-still.jpg';
const ART_W = 1440;
const ART_H = 900;

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Scales the artboard to cover the hero, like `background-size: cover`. */
function useCoverScale(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const scale = Math.max(el.clientWidth / ART_W, el.clientHeight / ART_H);
      el.style.setProperty('--art-scale', String(scale));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

export function Opening() {
  const reduced = useReducedMotion();
  const heroRef = useRef<HTMLDivElement>(null);
  useCoverScale(heroRef);
  const viewerRef = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const el = viewerRef.current;
    const done = () => setLoaded(true);
    el?.addEventListener('load', done);
    const timer = window.setTimeout(done, 7000);
    return () => {
      el?.removeEventListener('load', done);
      window.clearTimeout(timer);
    };
  }, [reduced]);

  useEffect(() => {
    if (reduced || document.querySelector(`script[src="${VIEWER_SRC}"]`)) return;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = VIEWER_SRC;
    document.head.appendChild(script);
  }, [reduced]);

  return (
    <div ref={heroRef} className={styles.hero} id="top">
      <div className={styles.art}>
        {/* Room glow, the floor line, the stream heading for the sieve, the gap, the thread. */}
        <svg className={styles.scene} viewBox={`0 0 ${ART_W} ${ART_H}`} aria-hidden="true">
          <defs>
            <radialGradient id="ldRoom" cx="50%" cy="50%" r="55%">
              <stop offset="0" stopColor="#7C3AED" stopOpacity="0.35" />
              <stop offset="1" stopColor="#050308" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="ldIrid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#22D3EE" /><stop offset="0.5" stopColor="#E879F9" /><stop offset="1" stopColor="#60A5FA" />
            </linearGradient>
            <linearGradient id="ldVig" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#050308" stopOpacity="0.3" />
              <stop offset="0.45" stopColor="#050308" stopOpacity="0" />
              <stop offset="1" stopColor="#050308" stopOpacity="0.75" />
            </linearGradient>
            <filter id="ldGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
          </defs>
          <rect width={ART_W} height={ART_H} fill="#050308" />
          <rect width={ART_W} height={ART_H} fill="url(#ldRoom)" />
          <path d="M0 842 L 612 860 L 826 814 L 1440 800" fill="none" stroke="#FFFFFF" strokeOpacity="0.08" />
          <g className={styles.streams} fill="none" stroke="#FFFFFF" strokeWidth="1" strokeOpacity="0.18">
            <path d="M-20 60 C 260 100, 470 260, 700 330" /><path d="M-20 140 C 260 170, 470 300, 700 360" />
            <path d="M-20 220 C 260 240, 470 330, 700 400" /><path d="M-20 300 C 260 310, 480 380, 700 430" />
            <path d="M-20 380 C 260 380, 480 420, 700 450" /><path d="M-20 450 C 260 450, 480 450, 700 452" />
            <path d="M-20 520 C 260 520, 480 490, 700 470" /><path d="M-20 600 C 260 590, 480 530, 700 500" />
            <path d="M-20 680 C 260 660, 480 580, 700 540" /><path d="M-20 760 C 260 730, 480 630, 700 580" />
          </g>
          <g className={styles.streams} fill="none" stroke="url(#ldIrid)" strokeWidth="1.2" strokeOpacity="0.45">
            <path d="M-20 340 C 260 350, 480 400, 700 440" /><path d="M-20 560 C 260 550, 480 510, 700 486" />
          </g>
        </svg>

        {(reduced || !loaded) && <img className={styles.still} src={STILL_SRC} alt="" aria-hidden="true" />}

        {/* The sieve: the Spline scene, full frame and transparent. The net, the items, the thread and the answer live in it. */}
        {!reduced && (
          <div className={styles.viewer}>
            {createElement('spline-viewer', {
              ref: viewerRef,
              url: SCENE_URL,
              'loading-anim-type': 'none',
              style: { position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' },
            })}
          </div>
        )}

        <svg className={styles.scene} viewBox={`0 0 ${ART_W} ${ART_H}`} aria-hidden="true">
          <rect className={styles.vignette} width={ART_W} height={ART_H} fill="url(#ldVig)" />
        </svg>

        {/* Three quiet labels, so the picture reads even still. */}
        <p className={`${styles.label} ${styles.labelLeft}`}>What an AI normally gets</p>
        <p className={`${styles.label} ${styles.labelMid}`}>The sieve, on your computer</p>
        <p className={`${styles.label} ${styles.labelRight}`}>What leaves</p>

        {/* 2 to 4 s: the name rises over the sieve, the nav fades in. */}
        <header className={styles.header}>
          <a href="#top" className={styles.brand}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#F4F1FA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" />
            </svg>
            <span>Sieve</span>
          </a>
          <nav className={styles.nav} aria-label="Landing">
            <a href="#how">How it works</a>
            <a href="#extension">Extension</a>
            <a href="https://github.com/1manideep/Sieve">GitHub</a>
            <Link to="/playground" className={styles.pill}>Playground</Link>
          </nav>
        </header>
        <div className={styles.nameWrap}>
          <h1 className={styles.name}>Sieve</h1>
          <p className={styles.tagline}>Give AI the answer, not your inbox.</p>
          <div className={styles.ctas}>
            <Link to="/playground" className={styles.ctaPrimary}>Try the Playground</Link>
            <a href="#video" className={styles.ctaSecondary}>Watch the video</a>
          </div>
        </div>
        <a href="#how" className={styles.scrollHint}><span className={styles.scrollLine} />Scroll</a>
      </div>
    </div>
  );
}
