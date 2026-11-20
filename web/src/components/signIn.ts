// Small helpers around Google sign-in for Welcome and the Playground (40 sections 6.3, 13.1 and 13.9).
import { useSession } from '@/state/session';

/** Resolves once the session store reports a Google user (the auth listener can land just after the popup resolves). */
export function waitForGoogle(timeoutMs = 5000): Promise<boolean> {
  if (useSession.getState().kind === 'google') return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = useSession.subscribe((s) => {
      if (s.kind !== 'google') return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/** A same-origin path from ?next= or ?back=, or the fallback: never another origin (no open redirect). */
export function safePath(value: string | null, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
