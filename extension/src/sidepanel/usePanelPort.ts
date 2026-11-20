// The panel's port to the service worker (50 section 8.1). Opens `sieve-panel`, says hello with its visibility
// and window id, pings every 20 s while visible, reconnects after 250 ms, 1 s, 2 s, then every 5 s, and closes
// the panel when the shortcut asks (50 section 8.9). Selection and announcements live in the same reducer, so
// they change only when a message arrives or the person acts, never in an effect.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ProposalPreview } from '@sieve/shared';
import { PANEL_PORT_NAME } from '../shared/internal';
import type { DecideRejection, PanelState, PanelToWorker, WorkerToPanel } from '../shared/internal';
import { newRequestAnnouncement, requesterName, resultCopy } from '../shared/labels';

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
}

export function chromePanelApi(): PanelApi {
  return {
    runtime: chrome.runtime,
    getWindowId: () => chrome.windows.getCurrent().then((w) => w.id),
    closePanel: () => window.close(),
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
      const keep = sel !== null && (st.proposals.some((p) => p.requestId === sel) || resolvedShown.some((r) => r.requestId === sel));
      const selectedId = keep ? sel : firstWaiting(st.proposals);
      let announcement = model.announcement;
      const prev = model.state;
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
    const hello = () => post({ type: 'panel/hello', visible: visible(), ...(windowId !== undefined ? { windowId } : {}) });

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
