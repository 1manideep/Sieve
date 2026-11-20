// Page watchers for the on-device model (10 section 7.7): warm the base sessions after the first click or key press,
// re-check availability on focus, and drop the sessions when the page goes away.
import { getNanoAvailability } from './availability';
import { dropBaseSessions, FOREGROUND_FIRST, warmBaseSessions } from './sessions';

let uninstall: (() => void) | null = null;

export function installNanoWatchers(): () => void {
  if (uninstall) return uninstall;
  if (typeof window === 'undefined') return () => undefined;

  let warmed = false;
  const onGesture = () => {
    if (warmed) return;
    warmed = true;
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    void getNanoAvailability()
      .then((s) => (s.text === 'available' ? warmBaseSessions(FOREGROUND_FIRST) : undefined))
      .catch(() => undefined);
  };
  const recheck = () => {
    void getNanoAvailability({ maxAgeMs: 0 }).catch(() => undefined);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') recheck();
  };
  const onPageHide = () => dropBaseSessions();

  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  window.addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  uninstall = () => {
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    window.removeEventListener('focus', recheck);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    uninstall = null;
  };
  return uninstall;
}
