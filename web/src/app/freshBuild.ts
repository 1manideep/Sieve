// A tab left open across a deploy keeps running the old build, and Hosting no longer serves that build's lazy chunks:
// the first dynamic import that needs one fails, and a request ends with "Sieve couldn't prepare an answer" (Nov 21,
// 2026). Two signals say the tab is stale: Vite's vite:preloadError event (a dynamic import's file failed to load) and
// a different entry script in a fresh copy of the page, checked every 5 minutes and when the tab is shown. A stale tab
// reloads itself when that is safe (after a new build only while it is shown); otherwise it shows one toast that
// stays, and reloads once it is safe.
// main.tsx starts it in production builds only (never in dev, e2e or unit tests). Nothing here throws.
import { FRESH_BUILD } from '@/copy/strings';
import { useAskPlayground, useAskReal, type AskPhase } from '@/state/ask';
import { useHomeBase, type EntryPhase, type PendingEntry } from '@/state/homeBase';
import { usePlaygroundRelay } from '@/state/playgroundRelay';
import { useToasts } from '@/state/toasts';

/** How often an open tab asks Hosting which build is current. */
export const CHECK_EVERY_MS = 5 * 60_000;
/** A tab shown again checks at most this often. */
export const SHOWN_CHECK_GAP_MS = 60_000;
/** At most one automatic reload in this long, per tab, so a build that keeps failing cannot loop. */
export const AUTO_RELOAD_GAP_MS = 5 * 60_000;
export const AUTO_RELOAD_KEY = 'sieve.autoReloadAt';

/** Work a reload would cut off: a relay request being claimed, prepared, shown to the person or decided. */
const BUSY_REQUEST: readonly EntryPhase[] = ['claiming', 'preparing', 'awaiting-person', 'deciding'];
/** The same for an in-app question: running, waiting for the person, or drafting. */
const BUSY_ASK: readonly AskPhase[] = ['preparing', 'ready', 'drafting'];
/** Input types nobody types into. */
const NOT_TYPED = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** The entry module script's URL; Vite puts the build's content hash in its file name. */
export function entryScriptOf(doc: ParentNode): string | null {
  return doc.querySelector('script[type=module][src]')?.getAttribute('src') ?? null;
}

function typing(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement) return !NOT_TYPED.has(el.type);
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

const busyEntries = (entries: Record<string, PendingEntry>) => Object.values(entries).some((e) => BUSY_REQUEST.includes(e.phase));

/**
 * Safe to reload: no relay request in flight in the home base or the Playground, no in-app question running or
 * waiting for the person, and the person is not typing.
 */
export function safeToReload(): boolean {
  if (busyEntries(useHomeBase.getState().entries) || busyEntries(usePlaygroundRelay.getState().entries)) return false;
  for (const ask of [useAskReal.getState(), useAskPlayground.getState()]) if (ask.approving || BUSY_ASK.includes(ask.phase)) return false;
  return !typing();
}

/** Notes an automatic reload now, or says no: one ran under AUTO_RELOAD_GAP_MS ago, or nothing can be noted. */
function noteAutoReload(now: number): boolean {
  try {
    const last = sessionStorage.getItem(AUTO_RELOAD_KEY);
    if (last !== null && now - Number(last) < AUTO_RELOAD_GAP_MS) return false;
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;   // with no record a reload loop could not be stopped, so the toast only
  }
}

export interface FreshBuildOptions {
  reload?: () => void;
  now?: () => number;
}

/** Listens for both signals until the returned function stops it. */
export function startFreshBuild(opts: FreshBuildOptions = {}): () => void {
  const reload = opts.reload ?? (() => window.location.reload());
  const now = opts.now ?? Date.now;
  const current = entryScriptOf(document);
  let stale = false;
  // A dynamic import already failed, so this tab is broken for that code: it reloads when safe, even hidden. A tab
  // that only learned of a new build reloads only while shown: after a reload the home base waits for a click in the
  // tab before it prepares anything (homeBaseEngine.ts, the activation gate), so a hidden working tab stays as it is.
  let failed = false;
  let checking = false;
  let lastCheck = now();
  let toastId: string | undefined;
  let offStores: (() => void)[] = [];
  // A store update, an event or a timer must never fail because of this module.
  const quiet = (fn: () => unknown) => () => {
    try {
      fn();
    } catch {
      // nothing to do: the next signal tries again
    }
  };
  const shown = () => document.visibilityState === 'visible';

  function tryReload(): boolean {
    if ((!failed && !shown()) || !navigator.onLine || !safeToReload() || !noteAutoReload(now())) return false;
    stop();
    reload();
    return true;
  }

  /** The sticky toast; `again`: show it once more if the person dismissed it. */
  function showToast(again: boolean): void {
    const toasts = useToasts.getState();
    if (toastId && (!again || toasts.toasts.some((t) => t.id === toastId))) return;
    toastId = toasts.push({ tone: 'info', title: FRESH_BUILD.toast, action: { label: FRESH_BUILD.reload, run: reload }, timeoutMs: Infinity });
  }

  function markStale(failedImport: boolean): void {
    failed ||= failedImport;
    if (!stale) {
      stale = true;
      const recheck = quiet(tryReload);
      offStores = [useHomeBase, usePlaygroundRelay, useAskReal, useAskPlayground].map((s) => s.subscribe(recheck));
    }
    if (tryReload()) return;
    if (failed || shown()) showToast(true);   // a new build seen while hidden waits for the tab to be shown
  }

  async function check(): Promise<void> {
    if (stale || checking || !current || !navigator.onLine) return;
    checking = true;
    lastCheck = now();
    try {
      // "/" and not "/index.html": Hosting's cleanUrls answers /index.html with a redirect to "/" (firebase.json)
      const res = await fetch('/', { cache: 'no-store' });
      const next = res.ok ? entryScriptOf(new DOMParser().parseFromString(await res.text(), 'text/html')) : null;
      if (next && next !== current) markStale(false);
    } catch {
      // offline, blocked or cut off: the next check tries again
    } finally {
      checking = false;
    }
  }

  // Offline, a failed chunk says nothing about a deploy. Never preventDefault(): the import must still reject, so the
  // caller's own catch runs.
  const onPreloadError = quiet(() => navigator.onLine && markStale(true));
  const onVisible = quiet(() => {
    if (!shown()) return;
    if (stale) {
      if (!tryReload()) showToast(false);
    } else if (now() - lastCheck >= SHOWN_CHECK_GAP_MS) void check();
  });
  const timer = setInterval(quiet(() => (stale ? tryReload() : check())), CHECK_EVERY_MS);
  window.addEventListener('vite:preloadError', onPreloadError);
  document.addEventListener('visibilitychange', onVisible);

  function stop(): void {
    clearInterval(timer);
    window.removeEventListener('vite:preloadError', onPreloadError);
    document.removeEventListener('visibilitychange', onVisible);
    for (const off of offStores) off();
    offStores = [];
  }
  return stop;
}
