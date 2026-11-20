// Firestore listeners that come back (70 section 3.6, R-PLAT-13). A Firestore onSnapshot that errors is finished
// and never fires again; a silently dead requests listener means a home base that looks online and never claims.
// On error: permission-denied or unauthenticated calls reauth(); true resubscribes once, false (or no reauth) stops.
// Any other code resubscribes after 1, 2, 5, 10, 30 s, then every 30 s; the backoff (and the one reauth) reset after
// 60 s live. Every `next` call sets 'live'. Logs carry the listener name and the error code only (P8).
import type { FirestoreError, Unsubscribe } from 'firebase/firestore';

export type ListenState = 'live' | 'retrying' | 'stopped';

export const LISTEN_BACKOFF_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];
export const LISTEN_RESET_AFTER_MS = 60_000;

export function resilientSnapshot(
  name: string,
  subscribe: (next: () => void, onError: (e: FirestoreError) => void) => Unsubscribe,
  opts?: { onState?: (s: ListenState) => void; reauth?: () => Promise<boolean> },
): Unsubscribe {
  let unsub: Unsubscribe | null = null;
  let closed = false;
  let attempt = 0;
  let liveSince = 0;
  let reauthed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: ListenState | undefined;

  const setState = (s: ListenState) => {
    if (s === state) return;
    state = s;
    try {
      opts?.onState?.(s);
    } catch (error) {
      console.error(`${name} listener state`, (error as { name?: string })?.name ?? 'error');
    }
  };

  const liveLongEnough = () => state === 'live' && Date.now() - liveSince >= LISTEN_RESET_AFTER_MS;

  const drop = () => {
    const u = unsub;
    unsub = null;
    try {
      u?.();
    } catch {
      // already gone
    }
  };

  function onError(gen: number, e: FirestoreError | undefined): void {
    if (closed || gen !== generation) return;
    generation++;
    drop();
    if (liveLongEnough()) {
      attempt = 0;
      reauthed = false;
    }
    const code = e?.code ?? 'unknown';
    console.error(`${name} listener`, code);
    if (code === 'permission-denied' || code === 'unauthenticated') {
      if (reauthed || !opts?.reauth) {
        setState('stopped');
        return;
      }
      reauthed = true;
      setState('retrying');
      let pending: Promise<boolean>;
      try {
        pending = opts.reauth();
      } catch {
        pending = Promise.resolve(false);
      }
      pending
        .then((ok) => {
          if (closed) return;
          if (ok) open();
          else setState('stopped');
        })
        .catch(() => {
          if (!closed) setState('stopped');
        });
      return;
    }
    const delay = LISTEN_BACKOFF_MS[Math.min(attempt, LISTEN_BACKOFF_MS.length - 1)] ?? 30_000;
    attempt++;
    setState('retrying');
    timer = setTimeout(open, delay);
  }

  function open(): void {
    if (closed) return;
    const gen = generation;
    try {
      const u = subscribe(
        () => {
          if (closed || gen !== generation) return;
          if (state !== 'live') liveSince = Date.now();
          else if (Date.now() - liveSince >= LISTEN_RESET_AFTER_MS) {
            attempt = 0;
            reauthed = false;
          }
          setState('live');
        },
        (e) => onError(gen, e),
      );
      if (closed || gen !== generation) {
        try {
          u();   // it errored (or was closed) before subscribe returned
        } catch {
          // already gone
        }
      } else {
        unsub = u;
      }
    } catch (error) {
      onError(gen, error as FirestoreError);
    }
  }

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    drop();
  };
}
