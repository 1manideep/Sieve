// useHomeBase (40 section 9.5). Google-scoped. Wraps relay/homeBaseEngine.ts, which holds the logic. The engine is
// attached by app/googleSession.ts (loaded only after sign-in), so this module imports no relay or Firebase code.
import { create } from 'zustand';
import type { LadderStep, Proposal, StepOption } from '@sieve/shared';
import { DECIDE_ERRORS } from '@/copy/strings';
import type { DeviceView, LiveStep, RelayRequestView } from './types';

export type HomeBaseRole = 'signed-out' | 'not-home-base' | 'other-device' | 'starting' | 'standby' | 'active' | 'error';
export type EntryPhase = 'claiming' | 'preparing' | 'awaiting-person' | 'deciding' | 'done';
export type ExtensionStatus = 'off' | 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'not-installed';

export interface PendingEntry {
  requestId: string;
  request: RelayRequestView;
  phase: EntryPhase;
  liveSteps: LiveStep[];
  answerPreview: string;                          // streamed on-device answer while preparing; local only
  proposal?: Proposal;
  relatedSelected: string[];                      // record ids ticked in the app
  relatedOptions: Record<string, StepOption[]>;   // CR-3 buildRelatedOptions, per ticked id
  relatedLoading: string[];
  lastPreviewItemIds: string[];                   // the item ids behind the last 'sieve/pending' sent to the extension
  result?:
    | { kind: 'sent'; step: LadderStep; itemCount: number; by: 'app' | 'extension' }
    | { kind: 'declined'; by: 'app' | 'extension' }
    | { kind: 'auto'; status: 'blocked' | 'no-match' | 'error' }
    | { kind: 'ended'; status: 'expired' | 'revoked' };
  error?: string;
}

export type DecideResult =
  | { ok: true }
  | { ok: false; reason: 'not-pending' | 'invalid-step' | 'too-long' | 'expired' | 'offline' | 'error'; message: string };

export interface HomeBaseState {
  role: HomeBaseRole;
  homeBaseDeviceId?: string;
  homeBaseLabel?: string;
  presence: 'unknown' | 'online' | 'offline';
  extension: ExtensionStatus;
  entries: Record<string, PendingEntry>;
  order: string[];                                // requestIds, oldest first
  recent: RelayRequestView[];                     // last 50 request docs, newest first
  awaitingCount: number;                          // entries in phase 'awaiting-person'
  /** A request waits for the first click in this tab (40 section 11.6); drives "Home base needs a click". */
  waitingForClick: boolean;
  /** The requests listener (70 section 3.6): 'retrying' reads "Home base reconnecting", 'stopped' asks to sign in again. */
  listener: 'live' | 'retrying' | 'stopped';
  /** Why the role is 'error' (40 section 11.1), for "The home base couldn't start. {reason}". */
  errorReason?: string;
  /** The extension's open-sieve key binding from sieve/hello-ack; '' when unset (01 section 6, 50 section 8.9). */
  extensionShortcut?: string;
  devices: DeviceView[];
  makeThisHomeBase(label: string): Promise<void>;
  stopBeingHomeBase(): Promise<void>;
  useThisTab(): Promise<void>;                    // steal the lock from another tab
  toggleRelated(requestId: string, recordId: string): Promise<void>;
  decide(input: { requestId: string; approved: boolean; step?: LadderStep; decidedBy: 'app' | 'extension' }): Promise<DecideResult>;
  allowCloudFor(requestId: string, recordId: string): Promise<void>;
  dismissDone(requestId: string): void;
  /** Stop on a preparing card: aborts the preparation; the request stays claimed and is not prepared again here. */
  stopPreparing(requestId: string): Promise<void>;
  reset(): void;
}

/** The engine methods the store calls (relay/homeBaseEngine.ts implements them). */
export interface HomeBaseEngineHandle {
  makeThisHomeBase(label: string): Promise<void>;
  stopBeingHomeBase(): Promise<void>;
  useThisTab(): Promise<void>;
  toggleRelated(requestId: string, recordId: string): Promise<void>;
  decide(input: { requestId: string; approved: boolean; step?: LadderStep; decidedBy: 'app' | 'extension' }): Promise<DecideResult>;
  allowCloudFor(requestId: string, recordId: string): Promise<void>;
  dismissDone(requestId: string): void;
  stopPreparing(requestId: string): Promise<void>;
}

let engine: HomeBaseEngineHandle | null = null;

/** Called by the Google session when the engine starts (and with null when it stops). */
export function attachHomeBaseEngine(e: HomeBaseEngineHandle | null): void {
  engine = e;
}

export function getHomeBaseEngine(): HomeBaseEngineHandle | null {
  return engine;
}

const initial = (): Omit<HomeBaseState,
  'makeThisHomeBase' | 'stopBeingHomeBase' | 'useThisTab' | 'toggleRelated' | 'decide' | 'allowCloudFor' | 'dismissDone' | 'stopPreparing' | 'reset'> => ({
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

export const useHomeBase = create<HomeBaseState>()((set) => ({
  ...initial(),
  makeThisHomeBase: async (label) => {
    await engine?.makeThisHomeBase(label);
  },
  stopBeingHomeBase: async () => {
    await engine?.stopBeingHomeBase();
  },
  useThisTab: async () => {
    await engine?.useThisTab();
  },
  toggleRelated: async (requestId, recordId) => {
    await engine?.toggleRelated(requestId, recordId);
  },
  decide: async (input) =>
    engine ? engine.decide(input) : { ok: false, reason: 'not-pending', message: DECIDE_ERRORS.notPending },
  allowCloudFor: async (requestId, recordId) => {
    await engine?.allowCloudFor(requestId, recordId);
  },
  dismissDone: (requestId) => {
    engine?.dismissDone(requestId);
  },
  stopPreparing: async (requestId) => {
    await engine?.stopPreparing(requestId);
  },
  reset: () => set(initial()),
}));
