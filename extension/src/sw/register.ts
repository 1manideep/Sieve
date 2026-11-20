// Wires chrome events to the hub (50 sections 7.1 to 7.4, 8.9 and 9). The only worker file that touches chrome.*;
// it takes the API object as a parameter so unit tests pass a fake. Every listener is added synchronously.
import { HOME_BASE_PORT_NAME, MESSAGE_VERSION } from '@sieve/shared';
import type { ExtensionToPage } from '@sieve/shared';
import { ALLOWED_ORIGINS, BUILD_MODE } from '../shared/env';
import { COMMAND_OPEN_SIEVE, PANEL_PORT_NAME } from '../shared/internal';
import type { PanelState, WorkerToPanel } from '../shared/internal';
import { parsePageMessage, parsePanelMessage } from '../shared/validate';
import { BADGE_COLOR, BADGE_TEXT_COLOR, badgeFor } from './badge';
import { openApp } from './focus';
import { GRACE_MS, Hub, isActionable, MAX_CONNECTIONS } from './hub';
import { createNotifier, requestIdOfNotification } from './notify';

export const HELLO_TIMEOUT_MS = 5_000;
export const SLOW_MS = 15_000;
export const MAX_INVALID = 5;

export type CommandResult = 'open' | 'close' | 'ignored';

export interface RegisterDeps {
  now?: () => number;
  newId?: () => string;
}

export interface Registered {
  hub: Hub;
  /** The open-sieve shortcut handler; returns what it did (used by tests). */
  handleCommand(command: string, tab?: Pick<chrome.tabs.Tab, 'windowId'>): CommandResult;
  view(): PanelState;
}

interface PanelInfo {
  visible: boolean;
  windowId?: number;
}

/** Dev builds expose the shortcut handler so e2e tests can press it without a keyboard. */
export interface SieveDevHook {
  command(name: string, windowId: number): CommandResult;
  state(): PanelState;
  panelWindows(): number[];
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

  // 1 and 2 (50 section 7.1)
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  api.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
  api.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR }).catch(() => {});
  const notifier = createNotifier(api, debug); // reads the announced ids back from storage.session

  function safePost(port: chrome.runtime.Port, msg: unknown): void {
    try {
      port.postMessage(msg);
    } catch {
      // The port closed; its onDisconnect handler cleans up.
    }
  }

  function postTo(connId: string, msg: ExtensionToPage): void {
    const port = ports.get(connId);
    if (port) safePost(port, msg);
  }

  function anyPanelVisible(): boolean {
    for (const info of panels.values()) if (info.visible) return true;
    return false;
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
    const msg = parsePageMessage(raw);
    if (!msg) {
      const count = hub.invalid(connId);
      debug(`invalid message ${count}/${MAX_INVALID}`);
      if (count >= MAX_INVALID) drop(connId);
      return;
    }
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
        const { added, removed } = hub.setPending(connId, msg.proposals);
        for (const id of removed) notifier.clear(id);
        const fresh = added
          .map((id) => hub.find(id))
          .filter((p): p is NonNullable<typeof p> => p !== undefined && isActionable(p) && !hub.isInflight(p.requestId));
        void notifier.onAdded(fresh, anyPanelVisible);
        debug(`pending ${msg.proposals.length}, ${added.length} added, ${removed.length} removed`);
        update();
        return;
      }
      case 'sieve/resolved': {
        const { removed } = hub.resolved(connId, msg.requestId, msg.outcome);
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

  function panelInWindow(windowId: number): chrome.runtime.Port | undefined {
    for (const [port, info] of panels) if (info.windowId === windowId) return port;
    return undefined;
  }

  function onPanelMessage(port: chrome.runtime.Port, raw: unknown): void {
    const msg = parsePanelMessage(raw);
    if (!msg || !panels.has(port)) return;
    switch (msg.type) {
      case 'panel/hello':
        panels.set(port, { visible: msg.visible, ...(msg.windowId !== undefined ? { windowId: msg.windowId } : {}) });
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
        const r = hub.decide(msg.requestId, msg.approved, msg.step);
        if (!r.ok) {
          safePost(port, { type: 'panel/decide-rejected', requestId: msg.requestId, reason: r.reason } satisfies WorkerToPanel);
          return;
        }
        postTo(r.connId, { type: 'sieve/decision', version: MESSAGE_VERSION, decision: r.decision });
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
    }
  }

  // Side panel ports (50 section 7.4)
  api.runtime.onConnect.addListener((port) => {
    const s = port.sender;
    if (port.name !== PANEL_PORT_NAME || s?.id !== api.runtime.id || !s.url?.startsWith(api.runtime.getURL('sidepanel/'))) {
      port.disconnect();
      return;
    }
    panels.set(port, { visible: false });
    port.onMessage.addListener((raw: unknown) => onPanelMessage(port, raw));
    port.onDisconnect.addListener(() => {
      void api.runtime.lastError;
      panels.delete(port);
    });
    safePost(port, { type: 'panel/state', state: hub.view() } satisfies WorkerToPanel);
  });

  // The shortcut toggles the panel (50 section 8.9). Chrome accepts sidePanel.open() only inside the gesture, so
  // the open call is made synchronously: nothing is awaited before it.
  function handleCommand(command: string, tab?: Pick<chrome.tabs.Tab, 'windowId'>): CommandResult {
    if (command !== COMMAND_OPEN_SIEVE || tab?.windowId === undefined) return 'ignored';
    const windowId = tab.windowId;
    const panel = panelInWindow(windowId);
    if (!panel) {
      api.sidePanel.open({ windowId }).catch(() => {});
      return 'open';
    }
    safePost(panel, { type: 'panel/close' } satisfies WorkerToPanel); // the panel calls window.close()
    if (typeof api.sidePanel.close === 'function') api.sidePanel.close({ windowId }).catch(() => {}); // Chrome 141+
    return 'close';
  }
  api.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab);
  });

  // Notifications (50 section 7.7)
  api.notifications.onClicked.addListener((notificationId) => {
    const requestId = requestIdOfNotification(notificationId);
    if (!requestId) return;
    const windowId = hub.owner(requestId)?.windowId ?? hub.homeBaseConn()?.windowId;
    const fallback = () => {
      openApp(api, hub, postTo, requestId).catch(() => {});
    };
    if (windowId !== undefined) api.sidePanel.open({ windowId }).catch(fallback); // synchronous, inside the click
    else fallback();
    notifier.clear(requestId);
  });
  api.notifications.onClosed.addListener((notificationId, byUser) => {
    if (requestIdOfNotification(notificationId)) debug(`notification closed, by user ${byUser}`);
  });

  // 4. Grace timer: without a ready connection after 2 s, show the disconnected badge and state.
  setTimeout(update, GRACE_MS);

  const registered: Registered = { hub, handleCommand, view: () => hub.view() };
  if (BUILD_MODE === 'dev') {
    const hook: SieveDevHook = {
      command: (name, windowId) => handleCommand(name, { windowId }),
      state: () => hub.view(),
      panelWindows: () => [...panels.values()].flatMap((p) => (p.windowId === undefined ? [] : [p.windowId])),
    };
    (globalThis as { __sieveDev?: SieveDevHook }).__sieveDev = hook;
  }
  return registered;
}
