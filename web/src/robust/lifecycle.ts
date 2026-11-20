// Sleep, wake, freeze and discard (70 section 3.5, R-PLAT-02 to R-PLAT-04).
// Wakes: the Page Lifecycle `resume` event (after a freeze), the tab becoming visible, the browser coming online,
// and a 15 s interval whose ticks arrive more than 90 s apart (sleep or freeze; hidden tabs still tick about once a
// minute under Chrome's intensive throttling, which stays under 90 s). Wakes within 2 s are merged into one call.
// One shared set of listeners serves every subscriber.

export type WakeReason = 'resume' | 'visible' | 'online' | 'clock-jump';
export interface Wake { reason: WakeReason; gapMs: number }

export const WAKE_TICK_MS = 15_000;
export const WAKE_GAP_MS = 90_000;
export const WAKE_MERGE_MS = 2_000;

type WakeFn = (w: Wake) => void;

const subscribers = new Set<WakeFn>();
let uninstall: (() => void) | null = null;
let lastTick = 0;
let lastWake = -Infinity;

function fire(reason: WakeReason, gapMs: number): void {
  const now = Date.now();
  if (now - lastWake < WAKE_MERGE_MS) return;
  lastWake = now;
  for (const fn of [...subscribers]) {
    try {
      fn({ reason, gapMs });
    } catch (error) {
      console.error('wake handler', (error as { name?: string })?.name ?? 'error');
    }
  }
}

function install(): () => void {
  lastTick = Date.now();
  const sinceTick = () => Math.max(0, Date.now() - lastTick);
  const onResume = () => fire('resume', sinceTick());
  const onVisible = () => {
    if (document.visibilityState === 'visible') fire('visible', sinceTick());
  };
  const onOnline = () => fire('online', sinceTick());
  const tick = setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap > WAKE_GAP_MS) fire('clock-jump', gap);
  }, WAKE_TICK_MS);
  document.addEventListener('resume', onResume);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  return () => {
    clearInterval(tick);
    document.removeEventListener('resume', onResume);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  };
}

/** Calls fn after a sleep, freeze, return to the tab or reconnect. Returns an unsubscribe. */
export function onWake(fn: WakeFn): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  subscribers.add(fn);
  uninstall ??= install();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && uninstall) {
      uninstall();
      uninstall = null;
      lastWake = -Infinity;
    }
  };
}

/** document.wasDiscarded on this page load: Memory Saver unloaded the tab (R-PLAT-02). */
export function wasDiscarded(): boolean {
  return typeof document !== 'undefined' && (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;
}
