// /try (80 sections 1 and 7): ask the seat broker for a seat, then embed the seat's screen with a timer strip, or
// show the place in line (polled every 10 s), or the offline copy.
import { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button, LinkButton } from '@/components/Button/Button';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Spinner } from '@/components/Spinner/Spinner';
import {
  QUEUE_POLL_MS,
  checkQueue,
  endSeat,
  requestSeat,
  type SeatGranted,
  type SeatQueued,
} from '@/components/TryOnRealComputer/broker';
import { TRY, fillText } from '@/copy/screens-controls';
import { announce } from '@/state/announcer';
import styles from './try.module.css';

type View =
  | { kind: 'requesting' }
  | ({ kind: 'granted' } & Omit<SeatGranted, 'status'>)
  | ({ kind: 'queued' } & Omit<SeatQueued, 'status'>)
  | { kind: 'offline' }
  | { kind: 'limited' }
  | { kind: 'ended' };

const QUEUE_FAILURES_TO_GIVE_UP = 2;

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

export function Component() {
  useDocumentTitle(TRY.title);
  const [view, setView] = useState<View>({ kind: 'requesting' });
  const [attempt, setAttempt] = useState(0);

  // Ask for a seat on arrival and on "Try again".
  useEffect(() => {
    const ctl = new AbortController();
    requestSeat(ctl.signal)
      .then((reply) => {
        if (ctl.signal.aborted) return;
        setView(reply.status === 'limited' ? { kind: 'limited' } : toView(reply));
      })
      .catch(() => {
        if (!ctl.signal.aborted) setView({ kind: 'offline' });
      });
    return () => ctl.abort();
  }, [attempt]);

  useQueuePolling(view.kind === 'queued' ? view.ticket : undefined, setView);

  return (
    <div className={styles.page}>
      <PageHeader title={TRY.heading} lead={TRY.line} size="page" />
      {view.kind === 'requesting' ? (
        <p className={styles.status} role="status">
          <Spinner size={16} labelled={false} />
          {TRY.requesting}
        </p>
      ) : null}
      {view.kind === 'granted' ? (
        <Session view={view} onEnded={() => setView({ kind: 'ended' })} />
      ) : null}
      {view.kind === 'queued' ? (
        <Message
          text={fillText(TRY.queued, { n: view.position, m: view.etaMinutes })}
          live
        />
      ) : null}
      {view.kind === 'offline' ? <Message text={TRY.offline} /> : null}
      {view.kind === 'limited' ? <Message text={TRY.limited} /> : null}
      {view.kind === 'ended' ? (
        <Message
          text={TRY.ended}
          onAgain={() => {
            setView({ kind: 'requesting' });
            setAttempt((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
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

function Session({ view, onEnded }: { view: Extract<View, { kind: 'granted' }>; onEnded(): void }) {
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);
  const left = view.endsAt - now;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left <= 0) onEnded();
  }, [left, onEnded]);

  const end = useCallback(async () => {
    setEnding(true);
    if (view.lease) await endSeat(view.lease).catch(() => undefined);
    onEnded();
  }, [view.lease, onEnded]);

  return (
    <section className={styles.session} aria-label={TRY.stripLabel}>
      <div className={styles.strip}>
        <span className={styles.stripReal}>{TRY.stripReal}</span>
        <span aria-hidden="true">·</span>
        <span>{TRY.stripNano}</span>
        <span aria-hidden="true">·</span>
        <span role="timer" className={styles.timer}>
          {fillText(TRY.stripLeft, { time: formatLeft(left) })}
        </span>
        <span aria-hidden="true">·</span>
        <Button variant="secondary" size="sm" onClick={() => void end()} busy={ending} disabled={ending}>
          {TRY.endSession}
        </Button>
      </div>
      <div className={styles.screen}>
        <iframe
          className={styles.viewer}
          src={view.viewerUrl}
          title={TRY.viewerTitle}
          allow="clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="no-referrer"
        />
      </div>
    </section>
  );
}

function Message({ text, live, onAgain }: { text: string; live?: boolean; onAgain?(): void }) {
  return (
    <div className={styles.message}>
      <p className={styles.messageText} role={live ? 'status' : undefined}>
        {text}
      </p>
      <div className={styles.actions}>
        <LinkButton to="/playground" variant="primary">
          {TRY.openPlayground}
        </LinkButton>
        {onAgain ? (
          <Button variant="secondary" onClick={onAgain}>
            {TRY.again}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
