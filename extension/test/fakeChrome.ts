// A minimal in-memory `chrome` for the worker tests (50 section 14.1). Ports come in pairs; postMessage delivers a
// JSON round trip to the other end synchronously; disconnect() fires onDisconnect on the other end only, as in
// Chrome. Every API call is appended to `calls`, so tests can assert order.
export const FAKE_EXTENSION_ID = 'ackgioeokfkdnehjoaoeldnpgodhljcc';

type Listener<A extends unknown[]> = (...args: A) => void;

export class FakeEvent<A extends unknown[]> {
  listeners: Listener<A>[] = [];
  addListener(l: Listener<A>): void {
    this.listeners.push(l);
  }
  removeListener(l: Listener<A>): void {
    this.listeners = this.listeners.filter((x) => x !== l);
  }
  hasListener(l: Listener<A>): boolean {
    return this.listeners.includes(l);
  }
  hasListeners(): boolean {
    return this.listeners.length > 0;
  }
  emit(...args: A): void {
    for (const l of [...this.listeners]) l(...args);
  }
}

export interface FakeSender {
  id?: string;
  url?: string;
  origin?: string;
  frameId?: number;
  tab?: { id?: number; windowId?: number };
}

export class FakePort {
  readonly onMessage = new FakeEvent<[unknown, FakePort]>();
  readonly onDisconnect = new FakeEvent<[FakePort]>();
  /** Every message delivered to this end. */
  readonly received: unknown[] = [];
  other!: FakePort;
  connected = true;
  disconnectCalls = 0;

  constructor(
    readonly name: string,
    readonly sender?: FakeSender,
  ) {}

  postMessage(msg: unknown): void {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    const copy: unknown = JSON.parse(JSON.stringify(msg));
    this.other.received.push(copy);
    this.other.onMessage.emit(copy, this.other);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    if (!this.connected) return;
    this.connected = false;
    this.other.connected = false;
    this.other.onDisconnect.emit(this.other);
  }

  /** Messages received with the given type. */
  ofType<T extends { type: string }>(type: T['type']): T[] {
    return this.received.filter((m): m is T => (m as { type?: unknown }).type === type);
  }
}

export function portPair(name: string, sender: FakeSender): { near: FakePort; far: FakePort } {
  const near = new FakePort(name); // the page or panel end
  const far = new FakePort(name, sender); // the end the worker sees, with the sender
  near.other = far;
  far.other = near;
  return { near, far };
}

export interface FakeNotification {
  type: string;
  iconUrl: string;
  title: string;
  message: string;
  priority?: number;
  requireInteraction?: boolean;
}

export interface FakeChromeOptions {
  shortcut?: string | null; // null: commands.getAll() rejects
  sidePanelOpenRejects?: boolean;
  withSidePanelClose?: boolean;
  /** 'ok' (the default, Chrome 127+), 'rejects', or 'missing' (Chrome before 127: no action.openPopup). */
  openPopup?: 'ok' | 'rejects' | 'missing';
  session?: Record<string, unknown>;
  /** chrome.storage.local, where only the `settings` key may ever be written. */
  local?: Record<string, unknown>;
  /** What windows.getLastFocused({ windowTypes: ['normal'] }) gives; null rejects. Default: a window that does not
   *  have focus (the person is in another app), so a new request notifies unless a test gives focus. */
  lastFocused?: { id?: number; focused: boolean } | null;
  version?: string;
}

export function createFakeChrome(opts: FakeChromeOptions = {}) {
  const calls: string[] = [];
  const badge = { text: '', title: '', color: '', textColor: '' };
  const notifications = new Map<string, FakeNotification>();
  const session: Record<string, unknown> = opts.session ?? {};
  const local: Record<string, unknown> = opts.local ?? {};
  /** Calls that must never happen: storage.local remove or clear, and anything on storage.sync. */
  const localCalls: string[] = [];
  const lastFocusedQueries: unknown[] = [];
  const opened: { windowId?: number; tabId?: number }[] = [];
  const popups: { windowId?: number }[] = [];
  const behaviors: unknown[] = [];
  const closed: { windowId?: number }[] = [];
  const tabUpdates: { tabId: number; props: unknown }[] = [];
  const windowUpdates: { windowId: number; props: unknown }[] = [];
  const created: { url?: string }[] = [];

  const log = (name: string) => calls.push(name);
  const forbidden = (name: string) => () => {
    localCalls.push(name);
    return Promise.reject(new Error(`${name} must never be called`));
  };

  const sidePanel: Record<string, unknown> = {
    setPanelBehavior: (b: unknown) => {
      log('sidePanel.setPanelBehavior');
      behaviors.push(b);
      return Promise.resolve();
    },
    open: (o: { windowId?: number; tabId?: number }) => {
      log('sidePanel.open');
      opened.push(o);
      return opts.sidePanelOpenRejects
        ? Promise.reject(new Error('`sidePanel.open()` may only be called in response to a user gesture.'))
        : Promise.resolve();
    },
  };
  if (opts.withSidePanelClose) {
    sidePanel.close = (o: { windowId?: number }) => {
      log('sidePanel.close');
      closed.push(o);
      return Promise.resolve();
    };
  }

  const action: Record<string, unknown> = {};
  if ((opts.openPopup ?? 'ok') !== 'missing') {
    action.openPopup = (o: { windowId?: number } = {}) => {
      log('action.openPopup');
      popups.push(o);
      return opts.openPopup === 'rejects' ? Promise.reject(new Error('Failed to open popup.')) : Promise.resolve();
    };
  }

  const api = {
    runtime: {
      id: FAKE_EXTENSION_ID,
      lastError: undefined as unknown,
      getManifest: () => ({ manifest_version: 3, name: 'Sieve', version: opts.version ?? '0.1.0' }),
      getURL: (path: string) => `chrome-extension://${FAKE_EXTENSION_ID}/${path}`,
      onConnect: new FakeEvent<[FakePort]>(),
      onConnectExternal: new FakeEvent<[FakePort]>(),
    },
    action: {
      ...action,
      setBadgeText: (d: { text: string }) => {
        log('action.setBadgeText');
        badge.text = d.text;
        return Promise.resolve();
      },
      setBadgeBackgroundColor: (d: { color: string }) => {
        log('action.setBadgeBackgroundColor');
        badge.color = d.color;
        return Promise.resolve();
      },
      setBadgeTextColor: (d: { color: string }) => {
        log('action.setBadgeTextColor');
        badge.textColor = d.color;
        return Promise.resolve();
      },
      setTitle: (d: { title: string }) => {
        log('action.setTitle');
        badge.title = d.title;
        return Promise.resolve();
      },
      getBadgeText: () => Promise.resolve(badge.text),
    },
    notifications: {
      create: (id: string, o: FakeNotification) => {
        log('notifications.create');
        notifications.set(id, o);
        return Promise.resolve(id);
      },
      clear: (id: string) => {
        log('notifications.clear');
        return Promise.resolve(notifications.delete(id));
      },
      getAll: () => Promise.resolve(Object.fromEntries([...notifications.keys()].map((k) => [k, true]))),
      onClicked: new FakeEvent<[string]>(),
      onClosed: new FakeEvent<[string, boolean]>(),
    },
    sidePanel,
    storage: {
      session: {
        get: (key?: string | null) => {
          log('storage.session.get');
          if (key === null || key === undefined) return Promise.resolve({ ...session });
          return Promise.resolve(key in session ? { [key]: session[key] } : {});
        },
        set: (items: Record<string, unknown>) => {
          log('storage.session.set');
          Object.assign(session, JSON.parse(JSON.stringify(items)));
          return Promise.resolve();
        },
      },
      local: {
        get: (key?: string | null) => {
          log('storage.local.get');
          if (key === null || key === undefined) return Promise.resolve({ ...local });
          return Promise.resolve(key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {});
        },
        set: (items: Record<string, unknown>) => {
          log('storage.local.set');
          Object.assign(local, JSON.parse(JSON.stringify(items)));
          return Promise.resolve();
        },
        remove: forbidden('local.remove'),
        clear: forbidden('local.clear'),
      },
      sync: { get: forbidden('sync.get'), set: forbidden('sync.set') },
    },
    tabs: {
      update: (tabId: number, props: unknown) => {
        log('tabs.update');
        tabUpdates.push({ tabId, props });
        return Promise.resolve({ id: tabId });
      },
      create: (props: { url?: string }) => {
        log('tabs.create');
        created.push(props);
        return Promise.resolve({ id: 999 });
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      /** Fired by tests with focusWindow(); the worker reads focus from it synchronously. */
      onFocusChanged: new FakeEvent<[number]>(),
      update: (windowId: number, props: unknown) => {
        log('windows.update');
        windowUpdates.push({ windowId, props });
        return Promise.resolve({ id: windowId });
      },
      getCurrent: () => {
        log('windows.getCurrent');
        return Promise.resolve({ id: 1 });
      },
      getLastFocused: (query?: unknown) => {
        log('windows.getLastFocused');
        lastFocusedQueries.push(query);
        const win = opts.lastFocused === undefined ? { id: 1, focused: false } : opts.lastFocused;
        return win === null ? Promise.reject(new Error('No last-focused window')) : Promise.resolve({ ...win });
      },
    },
    commands: {
      getAll: () => {
        log('commands.getAll');
        if (opts.shortcut === null) return Promise.reject(new Error('commands unavailable'));
        return Promise.resolve([
          { name: 'open-sieve', shortcut: opts.shortcut ?? '⌃⇧S', description: 'Open or close Sieve' },
        ]);
      },
      onCommand: new FakeEvent<[string, { windowId?: number } | undefined]>(),
    },
  };

  /** Chrome reports a window as focused, or (null) that no Chrome window has focus. */
  function focusWindow(windowId: number | null): void {
    api.windows.onFocusChanged.emit(windowId ?? api.windows.WINDOW_ID_NONE);
  }

  function connectPage(sender: FakeSender, name = 'sieve-home-base'): FakePort {
    const { near, far } = portPair(name, sender);
    api.runtime.onConnectExternal.emit(far);
    return near;
  }

  function connectPanel(sender: FakeSender = { id: FAKE_EXTENSION_ID, url: `chrome-extension://${FAKE_EXTENSION_ID}/sidepanel/index.html` }, name = 'sieve-panel'): FakePort {
    const { near, far } = portPair(name, sender);
    api.runtime.onConnect.emit(far);
    return near;
  }

  return {
    api: api as unknown as typeof chrome,
    raw: api,
    calls,
    badge,
    notifications,
    session,
    local,
    localCalls,
    lastFocusedQueries,
    opened,
    popups,
    behaviors,
    closed,
    tabUpdates,
    windowUpdates,
    created,
    connectPage,
    connectPanel,
    focusWindow,
  };
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;

export const PAGE_SENDER: FakeSender = {
  origin: 'http://localhost:5173',
  url: 'http://localhost:5173/requests',
  frameId: 0,
  tab: { id: 11, windowId: 1 },
};

export function pageSender(changes: Partial<FakeSender> = {}): FakeSender {
  return { ...PAGE_SENDER, ...changes };
}

/** Lets pending promise callbacks run (storage reads, commands.getAll, the popup try on arrival). */
export async function flush(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
