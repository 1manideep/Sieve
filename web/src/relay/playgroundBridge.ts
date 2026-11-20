// The Playground tab's port to the Sieve extension (50 sections 6.2 and 11, 60 section 7.2). The Playground opens it
// on mount when VITE_EXTENSION_ID is set, so "Send a test request to the extension" works for a judge who has not
// started the Playground assistant. When the Playground relay engine runs (00 D1), it attaches its handlers to this
// same port instead of opening a second one (50 section 6.2 rule 2: one port per tab): its requests reach the side
// panel and the panel's decisions reach its decide(). Test requests ride on the port through testRequests.wrapMakeBridge,
// exactly as on the Google session's bridge (app/googleSession.ts).
import { env } from '@/app/env';
import type { ExtensionStatus } from '@/state/homeBase';
import { createExtensionBridge, type BridgeHandlers, type ExtensionBridge } from './extensionBridge';
import { testRequests } from './testRequest';

export type MakeBridge = (handlers: BridgeHandlers) => ExtensionBridge | null;

export interface PlaygroundBridge {
  /** Opens the tab's port. Returns the stop for the unmount; the port closes when the last starter has stopped. */
  start(): () => void;
  /** 'off' while the extension is not configured (no VITE_EXTENSION_ID) or the port is not open. */
  status(): ExtensionStatus;
  subscribe(listener: () => void): () => void;
  /** EngineDeps.makeBridge for the Playground relay engine: a bridge that shares the tab's port; null when the extension is off. */
  makeEngineBridge: MakeBridge;
}

type Hello = Parameters<NonNullable<BridgeHandlers['onHello']>>[0];

/** `make` builds the tab's port (null: the extension is off). */
export function createPlaygroundBridge(make: MakeBridge | null): PlaygroundBridge {
  let engine: BridgeHandlers | null = null;      // the relay engine's handlers while it runs
  let bridge: ExtensionBridge | null = null;     // the port while the Playground is mounted
  let status: ExtensionStatus = 'off';
  let hello: Hello | null = null;
  let starters = 0;
  const listeners = new Set<() => void>();

  const call = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      console.error(`playground bridge ${what}`, error);
    }
  };

  const setStatus = (s: ExtensionStatus) => {
    if (s === status) return;
    status = s;
    if (s !== 'connected') hello = null;
    if (engine) call('status', () => engine?.onStatus(s));
    for (const listener of [...listeners]) call('listener', listener);
  };

  /** The page's handlers: what the extension sends goes to the engine while one is attached. */
  const page: BridgeHandlers = {
    onDecision: (input) => {
      if (engine) engine.onDecision(input);
      else bridge?.sendPending();   // nothing of ours is waiting: the panel gets the current (empty) list back
    },
    onOpenApp: (requestId) => engine?.onOpenApp(requestId),
    onStatus: setStatus,
    getPending: () => engine?.getPending() ?? [],
    onHello: (info) => {
      hello = info;
      engine?.onHello?.(info);
    },
  };

  return {
    start() {
      starters += 1;
      if (make && !bridge) {
        bridge = make(page);
        bridge?.start();
      }
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        starters -= 1;
        if (starters > 0 || !bridge) return;
        const b = bridge;
        bridge = null;
        b.stop();                  // reports 'idle' through onStatus
      };
    },

    status: () => status,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    makeEngineBridge(handlers) {
      if (!make) return null;
      let attached = false;
      return {
        start() {
          if (attached) return;
          attached = true;
          engine = handlers;
          call('engine status', () => handlers.onStatus(status));
          if (hello) call('engine hello', () => handlers.onHello?.(hello as Hello));
          bridge?.sendPending();    // the engine's list replaces the empty one
        },
        stop() {
          if (!attached) return;
          attached = false;
          if (engine === handlers) engine = null;
          bridge?.sendPending();    // the panel drops the engine's entries now, not at the next keepalive
        },
        sendPending: () => bridge?.sendPending(),
        sendResolved: (requestId, outcome) => bridge?.sendResolved(requestId, outcome),
      };
    },
  };
}

const extensionId = env.extensionId;

/** The one instance: the same createExtensionBridge call as the Google session, homeBase true for the Playground tab. */
export const playgroundBridge: PlaygroundBridge = createPlaygroundBridge(
  extensionId
    ? testRequests.wrapMakeBridge((handlers) => createExtensionBridge(extensionId, __APP_VERSION__, handlers, { homeBase: () => true }))
    : null,
);
