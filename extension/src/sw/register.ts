// Wires chrome events to the hub (50 sections 7.1 to 7.4, 8.9 and 9). The only worker file that touches chrome.*;
// it takes the API object as a parameter so unit tests pass a fake. Every listener is added synchronously.
// The panel page opens as the toolbar popup (manifest action.default_popup); the side panel stays as a second
// surface ("Keep open on the side"). The shortcut and a notification click choose, synchronously and inside the
// gesture, between chrome.action.openPopup() (Chrome 127+, a Chrome window has focus) and sidePanel.open() (no
// Chrome window has focus, or no openPopup). Chrome accepts sidePanel.open() only inside the gesture, so it is
// never called from a promise callback. A new request opens the popup by itself when the setting allows
// (arrival.ts); that path has no gesture, so it never opens the side panel, only the notification.
import { HOME_BASE_PORT_NAME, MESSAGE_VERSION } from '@sieve/shared';
import { ALLOWED_ORIGINS, BUILD_MODE } from '../shared/env';
import { COMMAND_OPEN_SIEVE, PANEL_PORT_NAME } from '../shared/internal';
import type { PanelState, Surface, ToPage, WorkerToPanel } from '../shared/internal';
import { parsePanelMessage, readPageMessage } from '../shared/validate';
import { BADGE_COLOR, BADGE_TEXT_COLOR, badgeFor } from './badge';
import { canOpenPopup, createArrivalOpener } from './arrival';
import { openApp } from './focus';
import { GRACE_MS, Hub, isActionable, MAX_CONNECTIONS } from './hub';
import { createNotifier, requestIdOfNotification } from './notify';

export const HELLO_TIMEOUT_MS = 5_000;
export const SLOW_MS = 15_000;
export const MAX_INVALID = 5;

/** 'popup': openPopup was called; 'open': sidePanel.open was called; 'close': a popup or panel was told to close. */
export type CommandResult = 'popup' | 'open' | 'close' | 'ignored';

/** One connected panel page, as the worker sees it (exposed for tests). */
export interface PanelView {
  surface: Surface;
  visible: boolean;
  windowId?: number;
}

export interface RegisterDeps {
  now?: () => number;
  newId?: () => string;
}

export interface Registered {
  hub: Hub;
  /** The open-sieve shortcut handler; returns what it did (used by tests). */
  handleCommand(command: string, tab?: Pick<chrome.tabs.Tab, 'windowId'>): CommandResult;
  view(): PanelState;
  /** The connected panel pages (popups and side panels). */
  panelViews(): PanelView[];
}

type PanelInfo = PanelView;

/** Dev builds expose the shortcut handler so e2e tests can press it without a keyboard. */
export interface SieveDevHook {
  command(name: string, windowId: number): CommandResult;
  state(): PanelState;
  panelWindows(): number[];
  panelViews(): PanelView[];
}

export function register(api: typeof chrome, deps: RegisterDeps = {}): Registered {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  // Logs message types and counts in dev only; never question text, titles or option text.
  const debug = BUILD_MODE === 'dev' ? (msg: string) => console.debug(`[sieve] ${msg}`) : () => {};
  const hub = new Hub(now);
  const ports = new Map<string, chrome.runtime.Port>();
  const panels = new Map<chrome.runtime.Port, PanelInfo>();
  const helloTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const slowTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // The Chrome window with focus: a window id, null when none has (the person is in another app), undefined until
  // Chrome first reports a change after this worker started. Kept so the open paths can choose without awaiting.
  let focusedWindow: number | null | undefined;

  // 1 and 2 (50 section 7.1). A click on the icon opens the popup: the side panel must not take the click, and
  // Chrome keeps this setting across restarts, so installs that had it on get it turned off here.
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  api.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
  api.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR }).catch(() => {});
  const notifier = createNotifier(api, debug); // reads the announced ids back from storage.session
  const arrival = createArrivalOpener(api, now);

  function safePost(port: chrome.runtime.Port, msg: unknown): void {
    try {
      port.postMessage(msg);
    } catch {
      // The port closed; its onDisconnect handler cleans up.
    }
  }

  function postTo(connId: string, msg: ToPage): void {
    const port = ports.get(connId);
    if (port) safePost(port, msg);
  }

  function anyPanelVisible(): boolean {
    for (const info of panels.values()) if (info.visible) return true;
    return false;
  }

  function stillWaiting(requestId: string): boolean {
    const p = hub.find(requestId);
    return p !== undefined && isActionable(p) && !hub.isInflight(requestId);
  }

  function syncBadge(): void {
    const state = hub.view();
    if (state.connection === 'connecting') return; // keep the last badge through a worker restart (2 s grace)
    const { text, title } = badgeFor(state, hub.actionableCount());
    api.action.setBadgeText({ text }).catch(() => {});
    api.action.setTitle({ title }).catch(() => {});
  }

  function broadcast(): void {
    if (panels.size === 0) return;
    const msg: WorkerToPanel = { type: 'panel/state', state: hub.view() };
    for (const port of panels.keys()) safePost(port, msg);
  }

  function update(): void {
    syncBadge();
    broadcast();
  }

  function clearSlow(requestId: string): void {
    const t = slowTimers.get(requestId);
    if (t !== undefined) clearTimeout(t);
    slowTimers.delete(requestId);
  }

  function onConnGone(connId: string): void {
    const timer = helloTimers.get(connId);
    if (timer !== undefined) clearTimeout(timer);
    helloTimers.delete(connId);
    if (!ports.delete(connId)) return; // already handled
    const { lost, removed } = hub.removeConn(connId);
    for (const id of removed) notifier.clear(id);
    for (const id of lost) {
      clearSlow(id);
      notifier.clear(id);
    }
    debug(`home base port closed, ${removed.length} removed, ${lost.length} lost`);
    update();
  }

  /** Our own port.disconnect() does not fire our onDisconnect listener, so clean up here too. */
  function drop(connId: string): void {
    const port = ports.get(connId);
    try {
      port?.disconnect();
    } catch {
      // already closed
    }
    onConnGone(connId);
  }

  async function readShortcut(): Promise<string | undefined> {
    try {
      const commands = await api.commands.getAll();
      return commands.find((c) => c.name === COMMAND_OPEN_SIEVE)?.shortcut ?? '';
    } catch {
      return undefined;
    }
  }

  async function sendAck(connId: string): Promise<void> {
    const shortcut = await readShortcut();
    postTo(connId, {
      type: 'sieve/hello-ack',
      version: MESSAGE_VERSION,
      extensionVersion: api.runtime.getManifest().version,
      ...(shortcut !== undefined ? { shortcut } : {}),
    });
  }

  function onPageMessage(connId: string, raw: unknown): void {
    if (!ports.has(connId)) return;
    const read = readPageMessage(raw);
    if (read.kind === 'invalid') {
      const count = hub.invalid(connId);
      debug(`invalid message ${count}/${MAX_INVALID}`);
      if (count >= MAX_INVALID) drop(connId);
      return;
    }
    if (read.kind === 'unknown') {
      debug('message of a newer page ignored'); // a type or value this build does not know: never counted
      return;
    }
    const msg = read.msg;
    if (read.skipped > 0) debug(`pending: ${read.skipped} proposals skipped`);
    if (!hub.isReady(connId) && msg.type !== 'sieve/hello') return;
    switch (msg.type) {
      case 'sieve/hello': {
        hub.hello(connId, msg.homeBase, msg.appVersion);
        const timer = helloTimers.get(connId);
        if (timer !== undefined) clearTimeout(timer);
        helloTimers.delete(connId);
        debug(`hello, homeBase ${msg.homeBase}`);
        void sendAck(connId);
        update();
        return;
      }
      case 'sieve/pending': {
        const { added, removed, changed } = hub.setPending(connId, msg.proposals, {
          ...(msg.preparing ? { preparing: msg.preparing } : {}),
          ...(msg.gmail ? { gmail: msg.gmail } : {}),
        });
        for (const id of removed) notifier.clear(id);
        for (const id of changed) clearSlow(id);
        const fresh = added
          .map((id) => hub.find(id))
          .filter((p): p is NonNullable<typeof p> => p !== undefined && isActionable(p) && !hub.isInflight(p.requestId));
        // New requests open the popup once (setting on, Chrome 127+, a focused window), else notify (50 section 7.7).
        void notifier.onAdded(fresh, { panelVisible: anyPanelVisible, open: () => arrival.open(), stillWaiting });
        debug(`pending ${msg.proposals.length}, ${added.length} added, ${removed.length} removed`);
        update();
        // An approval in flight whose text changed: the page refuses it, so ask the panel to check the new text.
        for (const id of changed) {
          for (const port of panels.keys()) safePost(port, { type: 'panel/decide-rejected', requestId: id, reason: 'changed' } satisfies WorkerToPanel);
        }
        return;
      }
      case 'sieve/resolved': {
        const { removed } = hub.resolved(connId, msg.requestId, msg.outcome, msg.message);
        clearSlow(msg.requestId);
        notifier.clear(msg.requestId);
        for (const id of removed) notifier.clear(id);
        debug(`resolved ${msg.outcome}`);
        update();
        return;
      }
    }
  }

  // Home base ports (50 sections 6.3 and 7.3)
  api.runtime.onConnectExternal.addListener((port) => {
    const s = port.sender;
    if (
      port.name !== HOME_BASE_PORT_NAME ||
      !s?.origin ||
      !ALLOWED_ORIGINS.includes(s.origin) ||
      s.frameId !== 0 ||
      !s.tab ||
      hub.connCount() >= MAX_CONNECTIONS
    ) {
      debug('external port refused');
      port.disconnect();
      return;
    }
    const id = newId();
    hub.addConn({
      id,
      origin: s.origin,
      ...(s.tab.id !== undefined ? { tabId: s.tab.id } : {}),
      ...(s.tab.windowId !== undefined ? { windowId: s.tab.windowId } : {}),
    });
    ports.set(id, port);
    helloTimers.set(
      id,
      setTimeout(() => {
        if (!hub.isReady(id)) drop(id);
      }, HELLO_TIMEOUT_MS),
    );
    port.onMessage.addListener((raw: unknown) => onPageMessage(id, raw));
    port.onDisconnect.addListener(() => {
      void api.runtime.lastError;
      onConnGone(id);
    });
  });

  function panelInWindow(windowId: number, surface: Surface): chrome.runtime.Port | undefined {
    for (const [port, info] of panels) if (info.windowId === windowId && info.surface === surface) return port;
    return undefined;
  }

  function onPanelMessage(port: chrome.runtime.Port, raw: unknown): void {
    const msg = parsePanelMessage(raw);
    if (!msg || !panels.has(port)) return;
    switch (msg.type) {
      case 'panel/hello':
        panels.set(port, {
          surface: msg.surface ?? 'panel',
          visible: msg.visible,
          ...(msg.windowId !== undefined ? { windowId: msg.windowId } : {}),
        });
        if (msg.surface === 'popup') arrival.popupConnected();
        safePost(port, { type: 'panel/state', state: hub.view() } satisfies WorkerToPanel);
        return;
      case 'panel/visibility': {
        const info = panels.get(port);
        if (info) info.visible = msg.visible;
        return;
      }
      case 'panel/ping':
        return; // keeps the worker alive while the person is looking
      case 'panel/decide': {
        const r = hub.decide(msg.requestId, msg.approved, msg.step, msg.textHash);
        if (!r.ok) {
          safePost(port, { type: 'panel/decide-rejected', requestId: msg.requestId, reason: r.reason } satisfies WorkerToPanel);
          return;
        }
        // The hash of the text the person approved goes back with it; the page refuses it if its text changed.
        postTo(r.connId, {
          type: 'sieve/decision',
          version: MESSAGE_VERSION,
          decision: r.decision,
          ...(r.textHash !== undefined ? { textHash: r.textHash } : {}),
        });
        notifier.clear(msg.requestId);
        clearSlow(msg.requestId);
        const requestId = msg.requestId;
        slowTimers.set(
          requestId,
          setTimeout(() => {
            slowTimers.delete(requestId);
            hub.markSlow(requestId);
            update();
          }, SLOW_MS),
        );
        debug(`decision sent, approved ${r.decision.approved}`);
        update();
        return;
      }
      case 'panel/open-app':
        openApp(api, hub, postTo, msg.requestId).catch(() => {});
        return;
      case 'panel/dismiss':
        hub.dismiss(msg.requestId);
        broadcast();
        return;
      case 'panel/open-side': {
        // The popup could not open the side panel itself: try from here, and close the popup only if it opened.
        const windowId = panels.get(port)?.windowId;
        if (windowId === undefined) return;
        api.sidePanel
          .open({ windowId })
          .then(() => safePost(port, { type: 'panel/close' } satisfies WorkerToPanel))
          .catch(() => {});
        return;
      }
    }
  }

  // Panel ports, from the popup or the side panel (50 section 7.4). Each page has one port; it is forgotten when
  // the page closes (a popup closes whenever it loses focus), so opening and closing never adds up.
  api.runtime.onConnect.addListener((port) => {
    const s = port.sender;
    if (port.name !== PANEL_PORT_NAME || s?.id !== api.runtime.id || !s.url?.startsWith(api.runtime.getURL('sidepanel/'))) {
      port.disconnect();
      return;
    }
    panels.set(port, { surface: 'panel', visible: false });
    port.onMessage.addListener((raw: unknown) => onPanelMessage(port, raw));
    port.onDisconnect.addListener(() => {
      void api.runtime.lastError;
      panels.delete(port);
    });
    safePost(port, { type: 'panel/state', state: hub.view() } satisfies WorkerToPanel);
  });

  // Window focus (50 sections 7.7 and 8.9), read synchronously by the two open paths below. Normal windows only,
  // like the popup on arrival; focus in any other kind of window counts as none.
  api.windows.onFocusChanged.addListener(
    (windowId) => {
      focusedWindow = windowId === api.windows.WINDOW_ID_NONE ? null : windowId;
    },
    { windowTypes: ['normal'] },
  );

  /**
   * Whether an open path should call openPopup (true) or sidePanel.open (false). The popup needs Chrome 127+ and a
   * Chrome window with focus: openPopup fails for a Chrome the person is not looking at. Decided before any call,
   * because a fallback from openPopup's promise runs after the gesture, where Chrome refuses sidePanel.open.
   * `whenUnknown` is the answer before Chrome has reported any focus change to this worker.
   */
  function popupFits(whenUnknown: boolean): boolean {
    if (!canOpenPopup(api)) return false;
    return focusedWindow === undefined ? whenUnknown : focusedWindow !== null;
  }

  // The shortcut toggles Sieve (50 section 8.9): it closes the popup or side panel showing in that window, or opens
  // Sieve there: the popup when a Chrome window has focus (a pressed shortcut means one has, so an unknown focus
  // counts as focused), else the side panel. Every lookup is synchronous and nothing is awaited before an open.
  // If Chrome refuses the popup, nothing else is tried: the gesture is gone by then.
  function handleCommand(command: string, tab?: Pick<chrome.tabs.Tab, 'windowId'>): CommandResult {
    if (command !== COMMAND_OPEN_SIEVE || tab?.windowId === undefined) return 'ignored';
    const windowId = tab.windowId;
    const popup = panelInWindow(windowId, 'popup');
    if (popup) {
      safePost(popup, { type: 'panel/close' } satisfies WorkerToPanel); // the popup calls window.close()
      return 'close';
    }
    const panel = panelInWindow(windowId, 'panel');
    if (panel) {
      safePost(panel, { type: 'panel/close' } satisfies WorkerToPanel); // the panel calls window.close()
      if (typeof api.sidePanel.close === 'function') api.sidePanel.close({ windowId }).catch(() => {}); // Chrome 141+
      return 'close';
    }
    if (popupFits(true)) {
      api.action.openPopup({ windowId }).catch(() => debug('shortcut: Chrome refused the popup'));
      return 'popup';
    }
    api.sidePanel.open({ windowId }).catch(() => debug('shortcut: Chrome refused the side panel'));
    return 'open';
  }
  api.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab);
  });

  // Notifications (50 section 7.7). A click opens Sieve, choosing synchronously inside the click: with a Chrome
  // window in focus, the popup in that window (where the person is looking); with none, or before Chrome has
  // reported focus, the side panel in the Sieve tab's window, which is then brought to the front. If the chosen
  // open fails, it focuses the Sieve tab instead (that needs no gesture).
  api.notifications.onClicked.addListener((notificationId) => {
    const requestId = requestIdOfNotification(notificationId);
    if (!requestId) return;
    const windowId = hub.owner(requestId)?.windowId ?? hub.homeBaseConn()?.windowId;
    const openTab = () => {
      openApp(api, hub, postTo, requestId).catch(() => {});
    };
    const focused = focusedWindow;
    if (popupFits(false) && typeof focused === 'number') {
      api.action.openPopup({ windowId: focused }).catch(openTab);
    } else if (windowId !== undefined) {
      api.sidePanel.open({ windowId }).then(
        () => api.windows.update(windowId, { focused: true }).then(() => {}, () => {}),
        openTab,
      );
    } else {
      openTab();
    }
    notifier.clear(requestId);
  });
  api.notifications.onClosed.addListener((notificationId, byUser) => {
    if (requestIdOfNotification(notificationId)) debug(`notification closed, by user ${byUser}`);
  });

  // 4. Grace timer: without a ready connection after 2 s, show the disconnected badge and state.
  setTimeout(update, GRACE_MS);

  const panelViews = (): PanelView[] => [...panels.values()].map((p) => ({ ...p }));
  const registered: Registered = { hub, handleCommand, view: () => hub.view(), panelViews };
  if (BUILD_MODE === 'dev') {
    const hook: SieveDevHook = {
      command: (name, windowId) => handleCommand(name, { windowId }),
      state: () => hub.view(),
      panelWindows: () => [...panels.values()].flatMap((p) => (p.windowId === undefined ? [] : [p.windowId])),
      panelViews,
    };
    (globalThis as { __sieveDev?: SieveDevHook }).__sieveDev = hook;
  }
  return registered;
}
