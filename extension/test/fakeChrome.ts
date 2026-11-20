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
  session?: Record<string, unknown>;
  version?: string;
}

export function createFakeChrome(opts: FakeChromeOptions = {}) {
  const calls: string[] = [];
  const badge = { text: '', title: '', color: '', textColor: '' };
  const notifications = new Map<string, FakeNotification>();
  const session: Record<string, unknown> = opts.session ?? {};
  const localCalls: string[] = [];
  const opened: { windowId?: number; tabId?: number }[] = [];
  const closed: { windowId?: number }[] = [];
  const tabUpdates: { tabId: number; props: unknown }[] = [];
  const windowUpdates: { windowId: number; props: unknown }[] = [];
  const created: { url?: string }[] = [];

  const log = (name: string) => calls.push(name);
  const local = (name: string) => () => {
    localCalls.push(name);
    return Promise.reject(new Error('storage.local must never be called'));
  };

  const sidePanel: Record<string, unknown> = {
    setPanelBehavior: (b: unknown) => {
      log('sidePanel.setPanelBehavior');
      void b;
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
      local: { get: local('get'), set: local('set'), remove: local('remove'), clear: local('clear') },
      sync: { get: local('sync.get'), set: local('sync.set') },
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
      update: (windowId: number, props: unknown) => {
        log('windows.update');
        windowUpdates.push({ windowId, props });
        return Promise.resolve({ id: windowId });
      },
      getCurrent: () => {
        log('windows.getCurrent');
        return Promise.resolve({ id: 1 });
      },
    },
    commands: {
      getAll: () => {
        log('commands.getAll');
        if (opts.shortcut === null) return Promise.reject(new Error('commands unavailable'));
        return Promise.resolve([
          { name: 'open-sieve', shortcut: opts.shortcut ?? '⌃⇧S', description: "Open or close Sieve's side panel" },
        ]);
      },
      onCommand: new FakeEvent<[string, { windowId?: number } | undefined]>(),
    },
  };

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
    localCalls,
    opened,
    closed,
    tabUpdates,
    windowUpdates,
    created,
    connectPage,
    connectPanel,
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

/** Lets pending promise callbacks run (storage reads, commands.getAll). */
export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
