import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FRESH_BUILD } from '@/copy/strings';
import { useAskReal } from '@/state/ask';
import { useHomeBase, type PendingEntry } from '@/state/homeBase';
import { usePlaygroundRelay } from '@/state/playgroundRelay';
import { useToasts } from '@/state/toasts';
import { AUTO_RELOAD_GAP_MS, AUTO_RELOAD_KEY, CHECK_EVERY_MS, SHOWN_CHECK_GAP_MS, entryScriptOf, startFreshBuild } from './freshBuild';

const OLD = '/assets/index-OLD.js';
const NEW = '/assets/index-NEW.js';
const page = (src: string) =>
  `<!doctype html><html><head><link rel="modulepreload" href="/assets/react-x.js"><script type="module" crossorigin src="${src}"></script></head><body><div id="root"></div></body></html>`;

function entries(phase: PendingEntry['phase']): Record<string, PendingEntry> {
  return { r1: { requestId: 'r1', phase } as PendingEntry };
}

function failedImport(): Event {
  const e = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

/** Lets the mocked fetch and the page text settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

let online = true;
let stop: (() => void) | undefined;
let reload: Mock<() => void>;
let script: HTMLScriptElement;

beforeEach(() => {
  script = document.createElement('script');
  script.setAttribute('type', 'module');
  script.setAttribute('src', OLD);
  document.head.append(script);
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  reload = vi.fn<() => void>();
  sessionStorage.clear();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  script.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  useToasts.setState({ toasts: [] });
  useHomeBase.setState({ entries: {} });
  usePlaygroundRelay.setState({ entries: {} });
  useAskReal.setState({ phase: 'idle', approving: false });
});

describe('entryScriptOf', () => {
  it('reads the entry module script, in this page and in a fetched one', () => {
    expect(entryScriptOf(document)).toBe(OLD);
    expect(entryScriptOf(new DOMParser().parseFromString(page(NEW), 'text/html'))).toBe(NEW);
    expect(entryScriptOf(new DOMParser().parseFromString('<p>Bad gateway</p>', 'text/html'))).toBeNull();
  });
});

describe('a failed dynamic import', () => {
  it('with nothing in flight: reloads at once and notes the time; the event is left alone, so the import still rejects', () => {
    stop = startFreshBuild({ reload, now: () => 5_000_000 });
    const e = failedImport();
    expect(e.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(AUTO_RELOAD_KEY)).toBe('5000000');
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('with a request in flight: one toast that stays, and the reload waits until the home base is idle', () => {
    useHomeBase.setState({ entries: entries('preparing') });
    stop = startFreshBuild({ reload });
    failedImport();
    failedImport();
    expect(reload).not.toHaveBeenCalled();
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ title: FRESH_BUILD.toast, timeoutMs: Infinity, action: { label: FRESH_BUILD.reload } });
    for (const phase of ['claiming', 'awaiting-person', 'deciding'] as const) {
      useHomeBase.setState({ entries: entries(phase) });
      expect(reload).not.toHaveBeenCalled();
    }
    useHomeBase.setState({ entries: entries('done') });
    expect(reload).toHaveBeenCalledTimes(1);
    useHomeBase.setState({ entries: {} });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('an in-app question or a Playground request in flight waits too', () => {
    useAskReal.setState({ phase: 'ready' });
    stop = startFreshBuild({ reload });
    failedImport();
    expect(reload).not.toHaveBeenCalled();
    usePlaygroundRelay.setState({ entries: entries('preparing') });
    useAskReal.setState({ phase: 'done' });
    expect(reload).not.toHaveBeenCalled();
    usePlaygroundRelay.setState({ entries: {} });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a cursor resting in an empty box holds nothing back: the stale tab reloads', () => {
    const box = document.createElement('textarea');
    document.body.append(box);
    box.focus();
    stop = startFreshBuild({ reload });
    failedImport();
    expect(reload).toHaveBeenCalledTimes(1);
    box.remove();
  });

  it('while the person types: the toast only, its Reload reloads, and the automatic reload waits for a change after typing', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.value = 'What did my landlord';
    input.focus();
    stop = startFreshBuild({ reload });
    failedImport();
    useHomeBase.setState({ presence: 'online' });
    expect(reload).not.toHaveBeenCalled();
    useToasts.getState().toasts[0]?.action?.run();
    expect(reload).toHaveBeenCalledTimes(1);
    input.blur();
    useHomeBase.setState({ presence: 'offline' });
    expect(reload).toHaveBeenCalledTimes(2);
    input.remove();
  });

  it('at most one automatic reload in 5 minutes: after a recent one, the toast only, until the gap has passed', () => {
    let t = 10_000_000;
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(t - 60_000));
    stop = startFreshBuild({ reload, now: () => t });
    failedImport();
    expect(reload).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toHaveLength(1);
    t += AUTO_RELOAD_GAP_MS;
    useHomeBase.setState({ presence: 'online' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without session storage, no automatic reload (a loop could not be stopped): the toast only', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    stop = startFreshBuild({ reload });
    expect(() => failedImport()).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('offline: a failed import says nothing about a deploy', () => {
    online = false;
    stop = startFreshBuild({ reload });
    failedImport();
    expect(reload).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toEqual([]);
  });
});

describe('the build check', () => {
  it('every 5 minutes: the same entry or a failed fetch does nothing; a new entry reloads', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, text: async () => page(OLD) }));
    vi.stubGlobal('fetch', fetchMock);
    stop = startFreshBuild({ reload });
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    await settle();
    // "/" itself: Hosting's cleanUrls would answer /index.html with a redirect to it
    expect(fetchMock).toHaveBeenCalledWith('/', { cache: 'no-store' });
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    await settle();
    fetchMock.mockImplementationOnce(async () => ({ ok: false, text: async () => page(NEW) }));
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    await settle();
    expect(reload).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async () => ({ ok: true, text: async () => page(NEW) }));
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('when the tab is shown, at most once a minute, and never offline', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, text: async () => page(NEW) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let t = 0;
    stop = startFreshBuild({ reload, now: () => t });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    t = SHOWN_CHECK_GAP_MS;
    online = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    online = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a stale tab that could not reload tries again when it is shown again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => page(NEW) })));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const input = document.createElement('textarea');
    document.body.append(input);
    input.value = 'half a question';
    input.focus();
    let t = 0;
    stop = startFreshBuild({ reload, now: () => t });
    t = SHOWN_CHECK_GAP_MS;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toHaveLength(1);
    input.blur();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('a new build seen while the tab is hidden: nothing until the tab is shown, then the reload', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => page(NEW) })));
    stop = startFreshBuild({ reload });
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    await settle();
    // a reload here would leave the home base waiting for a click, so a hidden tab that still works stays as it is
    useHomeBase.setState({ presence: 'online' });
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(reload).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toEqual([]);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a new build seen while hidden and busy: shown, the toast; idle and shown, the reload; hidden again, nothing', async () => {
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => page(NEW) })));
    useHomeBase.setState({ entries: entries('awaiting-person') });
    let t = 0;
    stop = startFreshBuild({ reload, now: () => t });
    t = SHOWN_CHECK_GAP_MS;
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toHaveLength(1);
    visibility = 'hidden';
    useHomeBase.setState({ entries: {} });
    expect(reload).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('a failed import in a hidden tab still reloads when safe: that tab is already broken', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    stop = startFreshBuild({ reload });
    failedImport();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
