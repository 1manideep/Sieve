// Sleep, wake, freeze and discard for the home base (70 sections 3.5, R-PLAT-01 to 04).
// Wakes: the Page Lifecycle `resume` event, the tab becoming visible, the browser coming online, and a clock jump
// (a 15 s tick that arrives more than 90 s late: sleep or freeze). Wakes within 2 s are merged into one call.

export { onWake, wasDiscarded, type WakeReason } from '@/robust/lifecycle';   // one shared set of listeners (70 section 3.5)

/** Resolves on the first pointerdown or keydown in this tab (the user activation the on-device model needs). */
export function onFirstInteraction(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => {
    window.removeEventListener('pointerdown', handler, true);
    window.removeEventListener('keydown', handler, true);
    fn();
  };
  window.addEventListener('pointerdown', handler, true);
  window.addEventListener('keydown', handler, true);
  return () => {
    window.removeEventListener('pointerdown', handler, true);
    window.removeEventListener('keydown', handler, true);
  };
}

/** Calls fn the next time the tab is visible (now, if it already is). */
export function whenVisible(fn: () => void): () => void {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    fn();
    return () => undefined;
  }
  const handler = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', handler);
    fn();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
