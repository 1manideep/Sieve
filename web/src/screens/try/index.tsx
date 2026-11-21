// /try (80 sections 1, 4 and 7; F6 and F6A in docs/design/final-flow.md). On arrival the page only asks the broker's
// GET /health how many seats are free, for the two seat rows; a seat is asked for (POST /seat) when the visitor
// presses Take seat 1 or Join the queue, so a look at the page never spends one of the browser's daily seats. Then the
// seat's screen shows in the 16:10 frame with the lease bar (time left, Full screen, Extend 5 min, End session), or
// the place in line (polled every 10 s), or the offline copy. Full screen asks the browser for it on the frame; when
// the browser refuses (or has no API, as on iPhone) the frame covers the window instead. Either way one glass pill at
// the bottom holds the seat's controls. When no seat can be had, Open Sieve signs in with Google: Sieve also works on
// the visitor's own computer, with their own data.
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button/Button';
import { Spinner } from '@/components/Spinner/Spinner';
import {
  HEALTH_FAILURES_TO_HIDE,
  HEALTH_POLL_MS,
  QUEUE_POLL_MS,
  checkHealth,
  checkQueue,
  endSeat,
  requestSeat,
  type SeatGranted,
  type SeatQueued,
} from '@/components/TryOnRealComputer/broker';
import { useOpenSieve } from '@/components/useOpenSieve';
import { SENTENCE, TRY, fillText } from '@/copy/screens-controls';
import { announce } from '@/state/announcer';
import styles from './try.module.css';

type Via = 'take' | 'queue';

type View =
  | { kind: 'idle' }
  | { kind: 'requesting'; via: Via }
  | ({ kind: 'granted' } & Omit<SeatGranted, 'status'>)
  | ({ kind: 'queued' } & Omit<SeatQueued, 'status'>)
  | { kind: 'offline' }
  | { kind: 'limited' }
  | { kind: 'ended' };

/** What GET /health last said: free seats out of the total, or that the broker did not answer. */
export type Health = { kind: 'checking' } | { kind: 'up'; free: number; total: number } | { kind: 'down' };

const CHECKING: Health = { kind: 'checking' };
const QUEUE_FAILURES_TO_GIVE_UP = 2;
const MAX_ROWS = 3;

/** "{mm:ss}" for the time left. */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toView(reply: SeatGranted | SeatQueued): View {
  if (reply.status === 'granted') return { kind: 'granted', viewerUrl: reply.viewerUrl, endsAt: reply.endsAt, lease: reply.lease };
  return { kind: 'queued', position: reply.position, etaMinutes: reply.etaMinutes, ticket: reply.ticket };
}

/** Moves focus to `ref` when the control that had it was just removed (focus fell back to the page). */
function rescueFocus(ref: RefObject<HTMLElement | null>): void {
  const active = document.activeElement;
  if (active === null || active === document.body) ref.current?.focus();
}

export function Component() {
  useDocumentTitle(TRY.title);
  const [view, setView] = useState<View>({ kind: 'idle' });
  // Bumped on Try again and when a session ends, so the seat rows ask the broker again.
  const [healthKey, setHealthKey] = useState(0);
  const health = useBrokerHealth(view.kind === 'idle' || view.kind === 'ended', healthKey);
  const requestRef = useRef<AbortController | null>(null);
  const nextRef = useRef<HTMLElement | null>(null);
  // Set when the visitor presses a button that goes away with its state (Take seat 1, Try again, End session).
  const wantFocus = useRef(false);

  useEffect(() => () => requestRef.current?.abort(), []);
  useQueuePolling(view.kind === 'queued' ? view.ticket : undefined, setView);

  // When the pressed button went away with the state it belonged to, the next step's first button takes the focus.
  useEffect(() => {
    if (!wantFocus.current || view.kind === 'requesting') return;
    wantFocus.current = false;
    rescueFocus(nextRef);
  }, [view.kind, health.kind]);

  /** POST /seat. The broker grants a free seat or puts this browser in line; both buttons ask the same way. */
  const ask = (via: Via) => {
    if (view.kind === 'requesting') return;
    requestRef.current?.abort();
    const ctl = new AbortController();
    requestRef.current = ctl;
    wantFocus.current = true;
    setView({ kind: 'requesting', via });
    requestSeat(ctl.signal)
      .then((reply) => {
        if (ctl.signal.aborted) return;
        if (reply.status === 'granted') announce(TRY.ready);
        setView(reply.status === 'limited' ? { kind: 'limited' } : toView(reply));
      })
      .catch(() => {
        if (!ctl.signal.aborted) setView({ kind: 'offline' });
      });
  };
  const retry = () => {
    wantFocus.current = true;
    setView({ kind: 'idle' });
    setHealthKey((n) => n + 1);
  };
  const ended = useCallback(() => {
    wantFocus.current = true;
    setView({ kind: 'ended' });
    setHealthKey((n) => n + 1);
  }, []);

  return (
    <div className={styles.page}>
      <div className={`ribbon ${styles.ribbon}`} aria-hidden="true" />
      <div className={styles.grid}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{TRY.eyebrow}</p>
          <h1 className={styles.title}>{TRY.heading}</h1>
          <p className={styles.lead}>{TRY.intro}</p>
          <SeatRows view={view} health={health} />
          <Next view={view} health={health} onAsk={ask} onRetry={retry} firstRef={nextRef} />
          <p className={styles.footnote}>{TRY.footnote}</p>
        </div>

        <div className={styles.side}>
          {view.kind === 'granted' ? <Session view={view} onEnded={ended} /> : <Placeholder />}
          <ul className={styles.facts} aria-label={TRY.factsLabel}>
            {TRY.facts.map((f) => (
              <li key={f.title} className={styles.fact}>
                <span className={styles.factTitle}>{f.title}</span>
                <span>{f.body}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className={styles.footer}>
        <span>
          {SENTENCE} {TRY.footer}
        </span>
        <span>{TRY.hosts}</span>
      </footer>
    </div>
  );
}

/** GET /health now, every 20 s while `active` (skipped while the tab is hidden) and when the tab is shown again. Before the first answer, and
 *  after `key` changes, the rows say "checking". The first check failing says "offline" at once; after a good answer
 *  it takes two failures in a row. */
function useBrokerHealth(active: boolean, key: number): Health {
  const [result, setResult] = useState<{ key: number; health: Health }>({ key: -1, health: CHECKING });
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let failures = 0;
    let answered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctl = new AbortController();
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') {
        inFlight = true;
        try {
          const h = await checkHealth(ctl.signal);
          if (stopped) return;
          failures = 0;
          answered = true;
          const total = Math.min(h.seatsTotal, MAX_ROWS);
          setResult({ key, health: total > 0 ? { kind: 'up', free: Math.min(h.seatsFree, total), total } : { kind: 'down' } });
        } catch {
          if (stopped) return;
          failures += 1;
          if (!answered || failures >= HEALTH_FAILURES_TO_HIDE) setResult({ key, health: { kind: 'down' } });
        } finally {
          inFlight = false;
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), HEALTH_POLL_MS);
    };
    // Back to the tab: check now instead of waiting out the 20 s (the seats may have changed while it was hidden).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctl.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, key]);
  return result.key === key ? result.health : CHECKING;
}

/** Polls GET /queue/{ticket} every 10 s; two failures in a row show the offline copy. */
function useQueuePolling(ticket: string | undefined, setView: (v: View) => void): void {
  useEffect(() => {
    if (ticket === undefined) return undefined;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctl = new AbortController();
    const poll = async () => {
      try {
        const next = await checkQueue(ticket, ctl.signal);
        if (stopped) return;
        failures = 0;
        if (next.status === 'granted') announce(TRY.ready);
        setView(toView(next));
        if (next.status === 'queued') timer = setTimeout(() => void poll(), QUEUE_POLL_MS);
      } catch {
        if (stopped) return;
        failures += 1;
        if (failures >= QUEUE_FAILURES_TO_GIVE_UP) setView({ kind: 'offline' });
        else timer = setTimeout(() => void poll(), QUEUE_POLL_MS);
      }
    };
    timer = setTimeout(() => void poll(), QUEUE_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctl.abort();
    };
  }, [ticket, setView]);
}

type Tone = 'ok' | 'wait' | 'idle';
interface Row { n: number; tone: Tone; status: string }

const rows = (count: number, row: (i: number) => Omit<Row, 'n'>): Row[] =>
  Array.from({ length: count }, (_, i) => ({ n: i + 1, ...row(i) }));

/** The seat rows from the broker's counts: free seats first, then the ones in use. */
export function healthRows(health: Health): Row[] {
  switch (health.kind) {
    case 'checking':
      return rows(2, () => ({ tone: 'idle', status: TRY.seatChecking }));
    case 'down':
      return rows(2, () => ({ tone: 'idle', status: TRY.seatOffline }));
    case 'up':
      return rows(health.total, (i) => (i < health.free ? { tone: 'ok', status: TRY.seatFree } : { tone: 'wait', status: TRY.seatInUse }));
  }
}

/** The rows for the page's state. The broker's replies say only what happened to this browser's request, so the
 *  other seats come from the last health answer. */
function seatRows(view: View, health: Health): Row[] {
  const total = health.kind === 'up' ? health.total : 2;
  switch (view.kind) {
    case 'granted': {
      const othersFree = health.kind === 'up' ? Math.max(0, health.free - 1) : 0;
      return rows(Math.max(total, 2), (i) => {
        if (i === 0) return { tone: 'ok', status: TRY.seatYours };
        if (health.kind !== 'up') return { tone: 'idle', status: TRY.seatOther };
        return i - 1 < othersFree ? { tone: 'ok', status: TRY.seatFree } : { tone: 'wait', status: TRY.seatInUse };
      });
    }
    case 'queued':
      return rows(total, () => ({ tone: 'wait', status: TRY.seatInUse }));
    case 'offline':
      return rows(total, () => ({ tone: 'idle', status: TRY.seatOffline }));
    default:
      return healthRows(health);
  }
}

const TONE: Record<Tone, string> = { ok: styles.ok, wait: styles.wait, idle: styles.idle };

function SeatRows({ view, health }: { view: View; health: Health }) {
  return (
    <ul className={styles.seats} aria-label={TRY.seatsLabel}>
      {seatRows(view, health).map((row) => (
        <li key={row.n} className={styles.seat}>
          <span className={styles.seatName}>
            <span className={`${styles.dot} ${TONE[row.tone]}`} aria-hidden="true" />
            {fillText(TRY.seatName, { n: row.n })}
          </span>
          <span className={styles.seatStatus}>{row.status}</span>
        </li>
      ))}
    </ul>
  );
}

interface NextProps {
  view: View;
  health: Health;
  onAsk(via: Via): void;
  onRetry(): void;
  /** Holds the next step's first button, for focus. */
  firstRef: MutableRefObject<HTMLElement | null>;
}

/** What the visitor can do next, by state. While a seat is open its controls sit under the frame. */
function Next({ view, health, onAsk, onRetry, firstRef }: NextProps) {
  const { openSieve: signIn, signingIn } = useOpenSieve();
  const first = (el: HTMLElement | null) => {
    firstRef.current = el;
  };
  const openSieve = (variant: 'primary' | 'secondary', isFirst = false) => (
    <Button
      variant={variant}
      size="lg"
      className={styles.big}
      ref={isFirst ? first : undefined}
      busy={signingIn}
      aria-disabled={signingIn || undefined}
      onClick={() => {
        if (!signingIn) void signIn();
      }}
    >
      {TRY.openSieve}
    </Button>
  );

  if (view.kind === 'idle' || view.kind === 'requesting') {
    if (view.kind === 'idle' && health.kind === 'down') {
      return (
        <Message text={TRY.offline}>
          {openSieve('primary', true)}
          <Button variant="secondary" size="lg" className={styles.big} onClick={onRetry}>
            {TRY.again}
          </Button>
        </Message>
      );
    }
    const busy = view.kind === 'requesting' ? view.via : undefined;
    const full = health.kind === 'up' && health.free === 0;
    const take = (
      <Button
        ref={full ? undefined : first}
        variant="primary"
        size="lg"
        className={styles.big}
        busy={busy === 'take'}
        aria-disabled={busy !== undefined || undefined}
        onClick={() => onAsk('take')}
      >
        {TRY.takeSeat}
      </Button>
    );
    const queue = (
      <Button
        ref={full ? first : undefined}
        variant={full ? 'primary' : 'secondary'}
        size="lg"
        className={styles.big}
        busy={busy === 'queue'}
        aria-disabled={busy !== undefined || undefined}
        onClick={() => onAsk('queue')}
      >
        {TRY.joinQueue}
      </Button>
    );
    return (
      <div className={styles.next}>
        {full ? <p className={styles.message}>{TRY.allInUse}</p> : null}
        <div className={styles.actions}>
          {full ? (
            <>
              {queue}
              {openSieve('secondary')}
            </>
          ) : (
            <>
              {take}
              {queue}
            </>
          )}
        </div>
        {busy !== undefined ? (
          <p className={styles.status} role="status">
            <Spinner size={16} labelled={false} />
            {TRY.requesting}
          </p>
        ) : null}
      </div>
    );
  }

  switch (view.kind) {
    case 'granted':
      return null;
    case 'queued':
      return (
        <Message text={fillText(TRY.queued, { n: view.position, m: view.etaMinutes })} live>
          {openSieve('primary', true)}
        </Message>
      );
    case 'offline':
      return (
        <Message text={TRY.offline}>
          {openSieve('primary', true)}
          <Button variant="secondary" size="lg" className={styles.big} onClick={onRetry}>
            {TRY.again}
          </Button>
        </Message>
      );
    case 'limited':
      return <Message text={TRY.limited}>{openSieve('primary', true)}</Message>;
    case 'ended':
      return (
        <Message text={TRY.ended}>
          <Button ref={first} variant="primary" size="lg" className={styles.big} onClick={() => onAsk('take')}>
            {TRY.takeSeat}
          </Button>
          {openSieve('secondary')}
        </Message>
      );
  }
}

function Message({ text, live, children }: { text: string; live?: boolean; children: ReactNode }) {
  return (
    <div className={styles.next}>
      <p className={styles.message} role={live ? 'status' : undefined}>
        {text}
      </p>
      <div className={styles.actions}>{children}</div>
    </div>
  );
}

/** The frame before a seat opens: the demo computer's home, faint, and where the seat will appear. */
function Placeholder() {
  return (
    <div className={styles.frame}>
      <div className={styles.frameDots} aria-hidden="true" />
      <div className={styles.frameRibbon} aria-hidden="true" />
      <div className={styles.ghostName} aria-hidden="true">Sieve</div>
      <div className={styles.ghostHeadline} aria-hidden="true">Ask your own data.</div>
      <div className={styles.ghostPrompt} aria-hidden="true" />
      <div className={styles.placeholder}>
        <span className={styles.placeholderTitle}>{TRY.placeholderTitle}</span>
        <span className={styles.placeholderLine}>{TRY.placeholderLine}</span>
      </div>
    </div>
  );
}

type FullMode = 'off' | 'native' | 'window';

function Session({ view, onEnded }: { view: Extract<View, { kind: 'granted' }>; onEnded(): void }) {
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);
  const [full, setFull] = useState<FullMode>('off');
  const frameRef = useRef<HTMLDivElement>(null);
  const fullButtonRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const wasFull = useRef(false);
  const left = view.endsAt - now;
  const time = fillText(TRY.stripLeft, { time: formatLeft(left) });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // The button that opened the seat is gone: Full screen, the seat's first control, takes the focus.
  useEffect(() => {
    rescueFocus(fullButtonRef);
  }, []);
  useEffect(() => {
    if (left <= 0) onEnded();
  }, [left, onEnded]);

  // The browser leaves full screen on Escape or its own controls: follow it.
  useEffect(() => {
    const onChange = () => {
      const inside = document.fullscreenElement != null && document.fullscreenElement === frameRef.current;
      setFull((mode) => (inside ? 'native' : mode === 'native' ? 'off' : mode));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The window-sized fallback: Escape leaves it, and the page behind does not scroll.
  useEffect(() => {
    if (full !== 'window') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFull('off');
    };
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [full]);

  // Focus follows the controls: into the pill on the way in, back to Full screen on the way out.
  useEffect(() => {
    if (full !== 'off') exitRef.current?.focus();
    else if (wasFull.current) fullButtonRef.current?.focus();
    wasFull.current = full !== 'off';
  }, [full]);

  const enterFull = () => {
    const el = frameRef.current;
    if (el === null) return;
    if (typeof el.requestFullscreen !== 'function') {
      setFull('window');
      return;
    }
    el.requestFullscreen().then(
      () => setFull('native'),
      () => setFull('window'),
    );
  };
  const exitFull = useCallback(() => {
    if (document.fullscreenElement != null && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => undefined);
    }
    setFull('off');
  }, []);

  const end = useCallback(async () => {
    setEnding(true);
    exitFull();
    if (view.lease) await endSeat(view.lease).catch(() => undefined);
    onEnded();
  }, [view.lease, onEnded, exitFull]);

  // The broker has no extend call yet (80 section 4 lists one extension of five minutes): say so, change nothing.
  const extend = () => announce(TRY.extendSoon);

  const frameClass = [styles.frame, styles.live, full !== 'off' ? styles.full : '', full === 'window' ? styles.window : '']
    .filter(Boolean)
    .join(' ');

  return (
    <section className={styles.session} aria-label={TRY.stripLabel}>
      <div ref={frameRef} className={frameClass}>
        <iframe
          className={styles.viewer}
          src={view.viewerUrl}
          title={TRY.viewerTitle}
          allow="clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="no-referrer"
        />
        {full !== 'off' ? (
          <>
            <div className={styles.pill} role="group" aria-label={TRY.seatBar}>
              <span className={styles.pillSeat}>
                <span className={`${styles.dot} ${styles.ok}`} aria-hidden="true" />
                {fillText(TRY.seatName, { n: 1 })} · <span className={styles.time}>{time}</span>
              </span>
              <Button variant="secondary" size="sm" className={styles.small} aria-disabled="true" onClick={extend}>
                {TRY.extend}
              </Button>
              <Button variant="secondary" size="sm" className={styles.small} busy={ending} disabled={ending} onClick={() => void end()}>
                {TRY.endSession}
              </Button>
              <Button ref={exitRef} variant="primary" size="sm" icon="compress" className={styles.small} onClick={exitFull}>
                {TRY.exitFullScreen}
              </Button>
            </div>
            <span className={styles.fullNote}>{TRY.fullNote}</span>
          </>
        ) : null}
      </div>

      <div className={styles.lease}>
        <span role="timer" className={styles.time}>
          {time}
        </span>
        <div className={styles.leaseActions}>
          <Button ref={fullButtonRef} variant="secondary" size="sm" icon="expand" className={styles.small} onClick={enterFull}>
            {TRY.fullScreen}
          </Button>
          <Button variant="secondary" size="sm" className={styles.small} aria-disabled="true" onClick={extend}>
            {TRY.extend}
          </Button>
          <Button variant="primary" size="sm" className={styles.small} busy={ending} disabled={ending} onClick={() => void end()}>
            {TRY.endSession}
          </Button>
        </div>
      </div>
    </section>
  );
}
