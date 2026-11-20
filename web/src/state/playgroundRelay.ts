// usePlaygroundRelay (00 D1, 30 section 16): the Playground page serves the requests that cloud Gemini, playing the
// outside AI, sends through the real MCP endpoint with a Playground grant. Same entry shape as useHomeBase; the engine
// runs in 'playground' mode (relay/playgroundRelay.ts, loaded with a dynamic import only when the Playground assistant
// starts, so Firestore stays out of the /playground first load). Works for anonymous visitors.
import { create } from 'zustand';
import { DECIDE_ERRORS } from '@/copy/strings';
import type { BridgeHandlers, ExtensionBridge } from '@/relay/extensionBridge';
import type { HomeBaseEngineHandle, HomeBaseState } from './homeBase';

type Actions = 'makeThisHomeBase' | 'stopBeingHomeBase' | 'useThisTab' | 'toggleRelated' | 'decide' | 'allowCloudFor' | 'dismissDone' | 'stopPreparing' | 'reset';
type MakeBridge = (handlers: BridgeHandlers) => ExtensionBridge | null;

export interface PlaygroundRelayState extends Omit<HomeBaseState, Actions> {
  status: 'idle' | 'starting' | 'running' | 'error';
  /** Listens to users/{uid}/requests for Playground requests. `makeBridge`: the Playground tab's port (50 section 11). */
  start(uid: string, makeBridge?: MakeBridge): () => void;
  toggleRelated: HomeBaseState['toggleRelated'];
  decide: HomeBaseState['decide'];
  allowCloudFor: HomeBaseState['allowCloudFor'];
  dismissDone: HomeBaseState['dismissDone'];
  stopPreparing: HomeBaseState['stopPreparing'];
  reset(): void;
}

const initial = (): Omit<PlaygroundRelayState, 'start' | 'toggleRelated' | 'decide' | 'allowCloudFor' | 'dismissDone' | 'stopPreparing' | 'reset'> => ({
  status: 'idle',
  role: 'signed-out',
  homeBaseDeviceId: undefined,
  homeBaseLabel: undefined,
  presence: 'unknown',
  extension: 'off',
  entries: {},
  order: [],
  recent: [],
  awaitingCount: 0,
  waitingForClick: false,
  listener: 'live',
  errorReason: undefined,
  extensionShortcut: undefined,
  devices: [],
});

let engine: HomeBaseEngineHandle | null = null;
let stopRunning: (() => Promise<void>) | null = null;
let token = 0;

export const usePlaygroundRelay = create<PlaygroundRelayState>()((set) => ({
  ...initial(),

  start(uid, makeBridge) {
    const mine = ++token;
    void stopRunning?.();
    stopRunning = null;
    engine = null;
    set({ ...initial(), status: 'starting' });
    void import('@/relay/playgroundRelay')
      .then((m) => m.startPlaygroundRelay(uid, makeBridge))
      .then((running) => {
        if (mine !== token) {
          void running.stop();
          return;
        }
        engine = running.engine;
        stopRunning = running.stop;
        set({ status: 'running' });
      })
      .catch((error: unknown) => {
        console.error('playground relay', error);
        if (mine === token) set({ status: 'error' });
      });
    return () => {
      if (mine !== token) return;
      token += 1;
      const stop = stopRunning;
      stopRunning = null;
      engine = null;
      void stop?.();
      set(initial());
    };
  },

  toggleRelated: async (requestId, recordId) => {
    await engine?.toggleRelated(requestId, recordId);
  },
  decide: async (input) => (engine ? engine.decide(input) : { ok: false, reason: 'not-pending', message: DECIDE_ERRORS.notPending }),
  allowCloudFor: async (requestId, recordId) => {
    await engine?.allowCloudFor(requestId, recordId);
  },
  dismissDone: (requestId) => engine?.dismissDone(requestId),
  stopPreparing: async (requestId) => {
    await engine?.stopPreparing(requestId);
  },
  reset() {
    token += 1;
    const stop = stopRunning;
    stopRunning = null;
    engine = null;
    void stop?.();
    set(initial());
  },
}));
