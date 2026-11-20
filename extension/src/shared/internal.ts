// Messages between the panel page and the service worker, and the state the panel renders (50 section 8.1).
// The toggle shortcut (50 section 8.9) adds `windowId` to panel/hello and the worker-to-panel `panel/close`.
// The same page runs as the toolbar popup and as the side panel; panel/hello says which (`surface`), and
// `panel/open-side` asks the worker to open the side panel when the popup cannot open it itself.
import type { LadderStep, ProposalPreview } from '@sieve/shared';

export const PANEL_PORT_NAME = 'sieve-panel';
export const COMMAND_OPEN_SIEVE = 'open-sieve';

/** Where the panel page is showing: the toolbar popup (the default way in) or Chrome's side panel. */
export type Surface = 'popup' | 'panel';
export const SURFACES = ['popup', 'panel'] as const satisfies readonly Surface[];

export type ConnectionState = 'connecting' | 'connected' | 'not-home-base' | 'disconnected';
export type ResolvedOutcome = 'approved' | 'declined' | 'expired' | 'error' | 'lost';
export type DecideRejection = 'unknown-request' | 'step-unavailable' | 'not-ready' | 'already-sent' | 'no-owner';

export interface ResolvedEntry {
  requestId: string;
  outcome: ResolvedOutcome;
  step?: LadderStep; // set when decided in this extension
  decidedHere: boolean;
  aiName: string;
  question: string;
  at: number;
}

export interface InflightEntry {
  requestId: string;
  approved: boolean;
  step?: LadderStep;
  sentAt: number;
  slow: boolean;
}

export interface PanelState {
  connection: ConnectionState;
  appUrl: string;
  proposals: ProposalPreview[]; // the union, owner order (oldest first within the home base)
  inflight: InflightEntry[];
  resolved: ResolvedEntry[]; // newest first, max 20, 10 minutes
}

export type PanelToWorker =
  | { type: 'panel/hello'; visible: boolean; windowId?: number; surface?: Surface }
  | { type: 'panel/visibility'; visible: boolean }
  | { type: 'panel/ping' }
  | { type: 'panel/decide'; requestId: string; approved: boolean; step?: LadderStep }
  | { type: 'panel/open-app'; requestId?: string }
  | { type: 'panel/dismiss'; requestId: string }
  | { type: 'panel/open-side' };

export type WorkerToPanel =
  | { type: 'panel/state'; state: PanelState }
  | { type: 'panel/decide-rejected'; requestId: string; reason: DecideRejection }
  | { type: 'panel/close' };
