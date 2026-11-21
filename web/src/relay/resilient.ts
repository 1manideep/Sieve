// Firestore listeners that come back (70 section 3.6). A Firestore onSnapshot that errors never fires again; a dead
// requests listener would leave a home base that looks online and never claims. On error: permission-denied or
// unauthenticated refreshes the ID token once and resubscribes (or stops); anything else resubscribes after
// 1, 2, 5, 10, 30 s, then every 30 s. The backoff and the token refresh reset after 60 s live.
import type { FirestoreError, Unsubscribe } from 'firebase/firestore';

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const RESET_AFTER_MS = 60_000;

export type ListenerState = 'live' | 'retrying' | 'stopped';

export function resilientSnapshot(
  name: string,
  subscribe: (next: () => void, onError: (e: FirestoreError) => void) => Unsubscribe,
  opts: { onState?: (s: ListenerState) => void; reauth?: () => Promise<boolean>; now?: () => number } = {},
): Unsubscribe {
  const now = opts.now ?? Date.now;
  let unsub: Unsubscribe | null = null;
  let closed = false;
  let attempt = 0;
  let liveSince = 0;
  let reauthed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: ListenerState | undefined;

  // After RESET_AFTER_MS live, the listener starts over: the backoff, and the one token refresh a permission error
  // gets (an ID token expires every hour, so a long-lived listener can need it again).
  const resetBackoff = () => {
    attempt = 0;
    reauthed = false;
  };

  const setState = (s: ListenerState) => {
    if (s === state) return;
    state = s;
    opts.onState?.(s);
  };

  const open = () => {
    if (closed) return;
    try {
      unsub = subscribe(
        () => {
          if (closed) return;
          if (state !== 'live') liveSince = now();
          else if (now() - liveSince >= RESET_AFTER_MS) resetBackoff();
          setState('live');
        },
        (e) => onError(e),
      );
    } catch (error) {
      onError(error as FirestoreError);
    }
  };

  const retry = () => {
    if (closed) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    setState('retrying');
    timer = setTimeout(open, delay);
  };

  function onError(e: FirestoreError): void {
    if (closed) return;
    unsub?.();
    unsub = null;
    if (state === 'live' && now() - liveSince >= RESET_AFTER_MS) resetBackoff();
    console.error(`${name} listener`, e?.code ?? 'error');
    if (e?.code === 'permission-denied' || e?.code === 'unauthenticated') {
      if (reauthed || !opts.reauth) {
        setState('stopped');
        return;
      }
      reauthed = true;
      setState('retrying');
      opts
        .reauth()
        .then((ok) => {
          if (closed) return;
          if (ok) open();
          else setState('stopped');
        })
        .catch(() => setState('stopped'));
      return;
    }
    retry();
  }

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    unsub?.();
    unsub = null;
  };
}
