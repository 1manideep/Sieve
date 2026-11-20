// ModelSetupPanel (40 sections 13.2, 13.2a and 16.18): the one-time, click-started setup of Gemini Nano with a real
// progress bar. The download only ever starts from the explicit button: its click handler calls startSetup() as its
// first statement, because Chrome allows the download only on a user gesture.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { announce } from '@/state/announcer';
import { useAvailability } from '@/state/availability';
import { formatEta } from '@/copy/format';
import { MODEL_SETUP_COPY, fill } from '@/copy/screens-main';
import { Button, LinkButton } from '../Button/Button';
import { Icon, type IconName } from '../icons';
import { ProgressBar } from '../ProgressBar/ProgressBar';
import { Tag } from '../Tag/Tag';
import { ETA_WINDOW_MS, panelState, percent, setupEtaMs, type ProgressSample } from './setupProgress';
import styles from './ModelSetupPanel.module.css';

export interface ModelSetupPanelProps {
  embedded?: boolean;              // Setup step 1: no H1
  backHref?: string;               // where "Continue" and "Back" go
  variant?: 'page' | 'embedded' | 'compact';   // compact: the setup strip on the demo seats' screen (13.2a)
}

const ANNOUNCE_AT = [25, 50, 75];
const STALL_MS = 10_000;

/** Must run synchronously in the click handler: no await before it (40 sections 9.3 and 13.2). */
function startSetupFromClick(): void {
  try {
    useAvailability.getState().startSetup();
  } catch (error) {
    console.error(error);
  }
}

/** ETA and the "stalled near 90%" hint, sampled from the store once a second while this tab downloads. */
function useSetupSamples(downloading: boolean): { etaMs?: number; stalled: boolean } {
  const [info, setInfo] = useState<{ etaMs?: number; stalled: boolean }>({ stalled: false });
  useEffect(() => {
    if (!downloading) return undefined;
    let samples: ProgressSample[] = [];
    let lastChange = Date.now();
    const record = () => {
      const at = Date.now();
      const fraction = useAvailability.getState().setup.fraction ?? 0;
      const prev = samples[samples.length - 1];
      if (!prev || prev.fraction !== fraction) lastChange = at;
      samples = [...samples.filter((s) => at - s.at <= ETA_WINDOW_MS), { at, fraction }];
      setInfo({ etaMs: setupEtaMs(samples, at), stalled: fraction >= 0.9 && at - lastChange >= STALL_MS });
    };
    const first = setTimeout(record, 0);
    const timer = setInterval(record, 1000);
    const unsubscribe = useAvailability.subscribe((s, p) => {
      if (s.setup.fraction !== p.setup.fraction) record();
    });
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      unsubscribe();
    };
  }, [downloading]);
  return downloading ? info : { stalled: false };
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <li className={styles.fact}>
      <Icon name={icon} size={20} className={styles.factIcon} />
      <span>{text}</span>
    </li>
  );
}

export function ModelSetupPanel({ embedded = false, backHref = '/ask', variant }: ModelSetupPanelProps) {
  const mode = variant ?? (embedded ? 'embedded' : 'page');
  const { text, setup } = useAvailability(useShallow((s) => ({ text: s.text, setup: s.setup })));
  const state = panelState(text, setup.state);
  const pct = percent(setup.fraction);
  const navigate = useNavigate();
  const { etaMs, stalled } = useSetupSamples(state === 'downloading');
  const announced = useRef<number>(0);
  const sawSetup = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  // Progress is announced at 25, 50 and 75 percent and on completion, never on every tick (40 section 13.2).
  useEffect(() => {
    if (mode === 'compact') return;
    if (state === 'downloading' || state === 'installing') sawSetup.current = true;
    if (state === 'downloading') {
      const step = ANNOUNCE_AT.filter((n) => pct >= n).pop() ?? 0;
      if (step > announced.current) {
        announced.current = step;
        announce(fill(MODEL_SETUP_COPY.announceStep, { pct: step }));
      }
    }
    if (state === 'ready' && sawSetup.current) {
      sawSetup.current = false;
      announced.current = 0;
      announce(MODEL_SETUP_COPY.announceReady);
      continueRef.current?.focus();
    }
  }, [mode, state, pct]);

  // "Start setup" has the initial focus on /prepare.
  useEffect(() => {
    if (mode === 'page' && state === 'idle') startRef.current?.focus();
    // Only when the state first becomes idle.
  }, [mode, state]);

  const go = () => navigate(backHref);

  if (mode === 'compact') return <CompactPanel state={state} pct={pct} error={setup.error} />;

  const Title = mode === 'page' ? 'h2' : 'h3';
  const intro = (
    <>
      {mode === 'page' ? <p className={styles.eyebrow}>{MODEL_SETUP_COPY.eyebrow}</p> : null}
      {mode === 'page' ? <h1 className={styles.heading}>{MODEL_SETUP_COPY.heading}</h1> : null}
      <p className={styles.lead}>{MODEL_SETUP_COPY.lead}</p>
      <ul className={styles.facts}>
        <Fact icon="device" text={MODEL_SETUP_COPY.factDevice} />
        <Fact icon="clock" text={MODEL_SETUP_COPY.factClock} />
        <Fact icon="disk" text={MODEL_SETUP_COPY.factDisk} />
      </ul>
    </>
  );

  let body: ReactNode = null;
  switch (state) {
    case 'checking':
      body = <p className={styles.line}>{MODEL_SETUP_COPY.checking}</p>;
      break;
    case 'idle':
      body = (
        <div>
          <Button ref={startRef} variant="primary" onClick={() => startSetupFromClick()}>
            {MODEL_SETUP_COPY.start}
          </Button>
        </div>
      );
      break;
    case 'downloading':
      body = (
        <div className={styles.progress}>
          <ProgressBar value={setup.fraction ?? 0} label={MODEL_SETUP_COPY.progressLabel} valueText={fill(MODEL_SETUP_COPY.valueText, { pct })} />
          <p className={styles.line} data-testid="setup-progress-text">
            {etaMs !== undefined
              ? fill(MODEL_SETUP_COPY.progressEta, { pct, eta: formatEta(etaMs) })
              : fill(MODEL_SETUP_COPY.progress, { pct })}
          </p>
          {stalled ? <p className={styles.line}>{MODEL_SETUP_COPY.finishing}</p> : null}
          <p className={styles.line}>{MODEL_SETUP_COPY.keepOpen}</p>
        </div>
      );
      break;
    case 'installing':
      body = (
        <div className={styles.progress}>
          <ProgressBar label={MODEL_SETUP_COPY.progressLabel} valueText={MODEL_SETUP_COPY.installing} />
          <p className={styles.strong}>{MODEL_SETUP_COPY.installing}</p>
          <p className={styles.line}>{MODEL_SETUP_COPY.installingBody}</p>
        </div>
      );
      break;
    case 'ready':
      body =
        mode === 'embedded' ? (
          <p className={styles.readyLine}>
            <Icon name="check" size={20} className={styles.check} />
            {MODEL_SETUP_COPY.readyEmbedded}
          </p>
        ) : (
          <div className={styles.ready}>
            <Icon name="check" size={28} className={styles.check} />
            <Title className={styles.subheading}>{MODEL_SETUP_COPY.readyTitle}</Title>
            <p className={styles.line}>{MODEL_SETUP_COPY.readyBody}</p>
            <div>
              <Button ref={continueRef} variant="primary" onClick={go}>
                {MODEL_SETUP_COPY.continue}
              </Button>
            </div>
          </div>
        );
      break;
    case 'elsewhere':
      body = (
        <div className={styles.progress}>
          <ProgressBar label={MODEL_SETUP_COPY.progressLabel} valueText={MODEL_SETUP_COPY.already} />
          <p className={styles.line}>{MODEL_SETUP_COPY.already}</p>
          <div>
            <Button variant="secondary" onClick={() => startSetupFromClick()}>
              {MODEL_SETUP_COPY.showProgress}
            </Button>
          </div>
        </div>
      );
      break;
    case 'error':
      body = (
        <div className={styles.progress} role="alert">
          <p className={styles.strong}>{MODEL_SETUP_COPY.errorTitle}</p>
          <p className={styles.line}>{setup.error || MODEL_SETUP_COPY.errorOther}</p>
          <div>
            <Button variant="primary" onClick={() => startSetupFromClick()}>
              {MODEL_SETUP_COPY.tryAgain}
            </Button>
          </div>
        </div>
      );
      break;
    case 'unavailable':
      body = (
        <div className={styles.progress}>
          <p className={styles.strong}>{MODEL_SETUP_COPY.unavailableTitle}</p>
          <p className={styles.line}>{MODEL_SETUP_COPY.unavailableBody}</p>
          <div className={styles.buttons}>
            <LinkButton to="/settings#cloud" variant="primary">
              {MODEL_SETUP_COPY.turnOnCloud}
            </LinkButton>
            {mode === 'page' ? (
              <Button variant="secondary" onClick={go}>
                {MODEL_SETUP_COPY.back}
              </Button>
            ) : null}
          </div>
        </div>
      );
      break;
  }

  return (
    <div className={`${styles.panel} ${mode === 'embedded' ? styles.embedded : ''}`} data-state={state}>
      {intro}
      {body}
    </div>
  );
}

function CompactPanel({ state, pct, error }: { state: ReturnType<typeof panelState>; pct: number; error?: string }) {
  const { pathname, search } = useLocation();
  switch (state) {
    case 'checking':
      return <p className={styles.compactLine}>{MODEL_SETUP_COPY.checking}</p>;
    case 'idle':
      return (
        <div className={styles.compact}>
          <p className={styles.compactLine}>{MODEL_SETUP_COPY.compactNotSetUp}</p>
          <Button variant="primary" size="sm" onClick={() => startSetupFromClick()}>
            {MODEL_SETUP_COPY.compactStart}
          </Button>
        </div>
      );
    case 'downloading':
      return (
        <div className={styles.compactColumn}>
          <p className={styles.compactLine}>{fill(MODEL_SETUP_COPY.compactProgress, { pct })}</p>
          <ProgressBar value={pct / 100} label={MODEL_SETUP_COPY.progressLabel} valueText={fill(MODEL_SETUP_COPY.valueText, { pct })} />
        </div>
      );
    case 'installing':
      return (
        <div className={styles.compactColumn}>
          <p className={styles.compactLine}>{MODEL_SETUP_COPY.compactInstalling}</p>
          <ProgressBar label={MODEL_SETUP_COPY.progressLabel} valueText={MODEL_SETUP_COPY.installing} />
        </div>
      );
    case 'elsewhere':
      return (
        <div className={styles.compact}>
          <p className={styles.compactLine}>{MODEL_SETUP_COPY.compactDownloading}</p>
          <Button variant="secondary" size="sm" onClick={() => startSetupFromClick()}>
            {MODEL_SETUP_COPY.showProgress}
          </Button>
        </div>
      );
    case 'error':
      return (
        <div className={styles.compact}>
          <p className={styles.compactLine}>{error || MODEL_SETUP_COPY.errorOther}</p>
          <Button variant="secondary" size="sm" onClick={() => startSetupFromClick()}>
            {MODEL_SETUP_COPY.tryAgain}
          </Button>
        </div>
      );
    case 'ready':
      return (
        <div className={styles.compact}>
          <Tag tone="device" icon="check">
            {MODEL_SETUP_COPY.compactReady}
          </Tag>
        </div>
      );
    case 'unavailable':
      return (
        <div className={styles.compact}>
          <p className={styles.compactLine}>{MODEL_SETUP_COPY.compactUnavailable}</p>
          <LinkButton to={`/prepare?back=${encodeURIComponent(pathname + search)}`} variant="ghost" size="sm">
            {MODEL_SETUP_COPY.compactWhy}
          </LinkButton>
        </div>
      );
  }
}
