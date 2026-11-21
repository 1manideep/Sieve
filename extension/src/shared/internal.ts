// Messages between the panel page and the service worker, and the state the panel renders (50 section 8.1).
// The toggle shortcut (50 section 8.9) adds `windowId` to panel/hello and the worker-to-panel `panel/close`.
// The same page runs as the toolbar popup and as the side panel; panel/hello says which (`surface`), and
// `panel/open-side` asks the worker to open the side panel when the popup cannot open it itself.
// Since 0.1.1 the page sends a short hash of each preview's outgoing text (`textHash`); the panel echoes it with an
// approval, and the worker sends it back with the decision, so the page can refuse an approval of text that changed.
import type { ExtensionToPage, LadderStep, ProposalPreview } from '@sieve/shared';

export const PANEL_PORT_NAME = 'sieve-panel';
export const COMMAND_OPEN_SIEVE = 'open-sieve';

/** Where the panel page is showing: the toolbar popup (the default way in) or Chrome's side panel. */
export type Surface = 'popup' | 'panel';
export const SURFACES = ['popup', 'panel'] as const satisfies readonly Surface[];

/** A preview as the extension keeps it: the contract's ProposalPreview plus the page's hash of its three option
 *  texts. Pages before 0.1.1 leave the hash out; the panel then sends none and nothing is compared. */
export type Preview = ProposalPreview & { textHash?: string };

/** sieve/decision as this extension sends it: an approval carries the hash of the text the person was shown. */
export type DecisionToPage = Extract<ExtensionToPage, { type: 'sieve/decision' }> & { textHash?: string };
export type ToPage = ExtensionToPage | DecisionToPage;

export type ConnectionState = 'connecting' | 'connected' | 'not-home-base' | 'disconnected';
export type ResolvedOutcome = 'approved' | 'declined' | 'expired' | 'error' | 'lost';
// 'changed': the text the panel showed is not the text the page holds now (the proposal changed under the person).
export type DecideRejection = 'unknown-request' | 'step-unavailable' | 'not-ready' | 'already-sent' | 'no-owner' | 'changed';

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
  proposals: Preview[]; // the union, owner order (oldest first within the home base)
  inflight: InflightEntry[];
  resolved: ResolvedEntry[]; // newest first, max 20, 10 minutes
}

export type PanelToWorker =
  | { type: 'panel/hello'; visible: boolean; windowId?: number; surface?: Surface }
  | { type: 'panel/visibility'; visible: boolean }
  | { type: 'panel/ping' }
  | { type: 'panel/decide'; requestId: string; approved: boolean; step?: LadderStep; textHash?: string }
  | { type: 'panel/open-app'; requestId?: string }
  | { type: 'panel/dismiss'; requestId: string }
  | { type: 'panel/open-side' };

export type WorkerToPanel =
  | { type: 'panel/state'; state: PanelState }
  | { type: 'panel/decide-rejected'; requestId: string; reason: DecideRejection }
  | { type: 'panel/close' };
