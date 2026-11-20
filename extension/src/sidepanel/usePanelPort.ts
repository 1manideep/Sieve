// The panel's port to the service worker (50 section 8.1). Opens `sieve-panel`, says hello with its visibility,
// window id and surface (popup or side panel), pings every 20 s while visible, reconnects after 250 ms, 1 s, 2 s,
// then every 5 s, and closes the page when the shortcut asks (50 section 8.9). A popup closes whenever it loses
// focus; its port goes with it and a new popup starts fresh. Selection and announcements live in the same
// reducer, so they change only when a message arrives or the person acts, never in an effect.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ProposalPreview } from '@sieve/shared';
import { PANEL_PORT_NAME } from '../shared/internal';
import type { DecideRejection, PanelState, PanelToWorker, ResolvedEntry, Surface, WorkerToPanel } from '../shared/internal';
import { newRequestAnnouncement, requesterName, resultCopy } from '../shared/labels';
import { readSettings, writeSettings } from '../shared/settings';
import type { SettingsStore } from './components/SettingsMenu';
import { detectSurface } from './surface';

export const RECONNECT_MS = [250, 1_000, 2_000, 5_000] as const;
export const PING_MS = 20_000;

/** What the panel needs from chrome; injectable for tests. */
export interface PanelApi {
  runtime: {
    connect(info: { name: string }): chrome.runtime.Port;
    readonly lastError?: unknown;
  };
  getWindowId?: () => Promise<number | undefined>;
  closePanel: () => void;
  /** Where the page is showing; 'panel' when left out. */
  surface?: Surface;
  /** Opens the side panel in this window (the popup's "Keep open on the side"); rejects when Chrome refuses. */
  openSidePanel?: () => Promise<void>;
  /** The extension settings (chrome.storage.local); without it the header shows no settings gear. */
  settings?: SettingsStore;
}

export function chromePanelApi(): PanelApi {
  let windowId: number | undefined;
  const getWindowId = () =>
    chrome.windows.getCurrent().then((w) => {
      windowId = w.id;
      return w.id;
    });
  return {
    runtime: chrome.runtime,
    getWindowId,
    closePanel: () => window.close(),
    surface: detectSurface(),
    // Called from the click, so Chrome sees the person's gesture. The window id is read once at start, so
    // nothing is awaited before sidePanel.open() unless that read has not come back yet.
    openSidePanel: async () => {
      const id = windowId ?? (await getWindowId());
      if (id === undefined) throw new Error('no window');
      await chrome.sidePanel.open({ windowId: id });
    },
    settings: {
      read: () => readSettings(chrome.storage.local),
      write: (change) => writeSettings(chrome.storage.local, change),
    },
  };
}

export interface PanelModel {
  state: PanelState | null;
  selectedId: string | null;
  lastRejection: { requestId: string; reason: DecideRejection } | null;
  announcement: { text: string; seq: number } | null;
  dismissed: string[];
}

export type PanelAction =
  | { type: 'state'; state: PanelState }
  | { type: 'rejected'; requestId: string; reason: DecideRejection }
  | { type: 'select'; requestId: string }
  | { type: 'done'; requestId: string }
  | { type: 'acted' };

export const initialModel: PanelModel = { state: null, selectedId: null, lastRejection: null, announcement: null, dismissed: [] };

function firstWaiting(proposals: ProposalPreview[], except?: string): string | null {
  return proposals.find((p) => p.requestId !== except)?.requestId ?? null;
}

/** The newest result of a decision made in this extension (approved, declined or lost here), not yet Done. A page
 *  that opens shows it first, so a popup closed during the approve animation reopens on the plain result card. */
function lastDecidedHere(resolved: ResolvedEntry[]): ResolvedEntry | undefined {
  return resolved.find((r) => r.decidedHere && (r.outcome === 'approved' || r.outcome === 'declined' || r.outcome === 'lost'));
}

function announce(model: PanelModel, text: string): PanelModel['announcement'] {
  return { text, seq: (model.announcement?.seq ?? 0) + 1 };
}

export function panelReducer(model: PanelModel, action: PanelAction): PanelModel {
  switch (action.type) {
    case 'state': {
      const st = action.state;
      const dismissed = model.dismissed.filter((id) => st.resolved.some((r) => r.requestId === id));
      const resolvedShown = st.resolved.filter((r) => !dismissed.includes(r.requestId));
      const sel = model.selectedId;
      const prev = model.state;
      const keep = sel !== null && (st.proposals.some((p) => p.requestId === sel) || resolvedShown.some((r) => r.requestId === sel));
      const reopened = prev === null && sel === null ? lastDecidedHere(resolvedShown) : undefined;
      const selectedId = keep ? sel : (reopened?.requestId ?? firstWaiting(st.proposals));
      let announcement = model.announcement;
      if (prev) {
        const justResolved = sel !== null && prev.proposals.some((p) => p.requestId === sel)
          ? resolvedShown.find((r) => r.requestId === sel)
          : undefined;
        const arrived = st.proposals.find((p) => !prev.proposals.some((q) => q.requestId === p.requestId));
        if (justResolved) announcement = announce(model, resultCopy(justResolved).heading);
        else if (arrived) announcement = announce(model, newRequestAnnouncement(requesterName(arrived.requester)));
      }
      const lastRejection = model.lastRejection && st.proposals.some((p) => p.requestId === model.lastRejection?.requestId)
        ? model.lastRejection
        : null;
      return { state: st, selectedId, lastRejection, announcement, dismissed };
    }
    case 'rejected':
      return { ...model, lastRejection: { requestId: action.requestId, reason: action.reason } };
    case 'select':
      return { ...model, selectedId: action.requestId, lastRejection: null };
    case 'done': {
      const proposals = model.state?.proposals ?? [];
      return {
        ...model,
        dismissed: [...model.dismissed, action.requestId],
        selectedId: firstWaiting(proposals, action.requestId),
        lastRejection: null,
      };
    }
    case 'acted':
      return { ...model, lastRejection: null };
  }
}

function isWorkerMessage(raw: unknown): raw is WorkerToPanel {
  if (typeof raw !== 'object' || raw === null) return false;
  const type = (raw as { type?: unknown }).type;
  if (type === 'panel/state') return typeof (raw as { state?: unknown }).state === 'object';
  return type === 'panel/decide-rejected' || type === 'panel/close';
}

export interface PanelPort {
  model: PanelModel;
  state: PanelState | null;
  lastRejection: PanelModel['lastRejection'];
  send(msg: PanelToWorker): void;
  select(requestId: string): void;
  done(requestId: string): void;
}

export function usePanelPort(api: PanelApi): PanelPort {
  const [model, dispatch] = useReducer(panelReducer, initialModel);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let windowId: number | undefined;
    const visible = () => document.visibilityState === 'visible';

    const post = (msg: PanelToWorker) => {
      try {
        portRef.current?.postMessage(msg);
      } catch {
        // disconnected; onDisconnect reconnects
      }
    };
    const surface = api.surface ?? 'panel';
    const hello = () =>
      post({ type: 'panel/hello', visible: visible(), ...(windowId !== undefined ? { windowId } : {}), surface });

    const onMessage = (raw: unknown) => {
      if (!isWorkerMessage(raw)) return;
      attempt = 0;
      if (raw.type === 'panel/state') dispatch({ type: 'state', state: raw.state });
      else if (raw.type === 'panel/decide-rejected') dispatch({ type: 'rejected', requestId: raw.requestId, reason: raw.reason });
      else api.closePanel();
    };

    const schedule = () => {
      const delay = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
      attempt += 1;
      retry = setTimeout(connect, delay);
    };

    function connect() {
      if (stopped) return;
      let port: chrome.runtime.Port;
      try {
        port = api.runtime.connect({ name: PANEL_PORT_NAME });
      } catch {
        schedule();
        return;
      }
      portRef.current = port;
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(() => {
        void api.runtime.lastError;
        if (portRef.current === port) portRef.current = null;
        if (!stopped) schedule();
      });
      hello();
    }

    connect();
    api.getWindowId?.()
      .then((id) => {
        if (stopped || id === undefined) return;
        windowId = id;
        hello();
      })
      .catch(() => {});

    const onVisibility = () => post({ type: 'panel/visibility', visible: visible() });
    document.addEventListener('visibilitychange', onVisibility);
    const ping = setInterval(() => {
      if (visible()) post({ type: 'panel/ping' });
    }, PING_MS);

    return () => {
      stopped = true;
      if (retry !== undefined) clearTimeout(retry);
      clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisibility);
      const port = portRef.current;
      portRef.current = null;
      try {
        port?.disconnect();
      } catch {
        // already closed
      }
    };
  }, [api]);

  const send = useCallback((msg: PanelToWorker) => {
    if (msg.type === 'panel/decide') dispatch({ type: 'acted' });
    try {
      portRef.current?.postMessage(msg);
    } catch {
      // disconnected; the reconnect brings a fresh state
    }
  }, []);

  const select = useCallback((requestId: string) => dispatch({ type: 'select', requestId }), []);

  const done = useCallback(
    (requestId: string) => {
      dispatch({ type: 'done', requestId });
      send({ type: 'panel/dismiss', requestId });
    },
    [send],
  );

  return { model, state: model.state, lastRejection: model.lastRejection, send, select, done };
}
