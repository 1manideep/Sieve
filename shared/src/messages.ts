// Page-to-extension messages (docs/spec/01-contracts.md section 6).
// Transport: chrome.runtime.connect(EXTENSION_ID, { name: HOME_BASE_PORT_NAME }). Every message carries
// version: MESSAGE_VERSION; unknown types or versions are ignored.
import type {
  Category,
  CategoryRule,
  Decision,
  ItemKind,
  LadderStep,
  ProposalOutcome,
  RequesterRef,
  StepOption,
  Warning,
} from './types';

export interface ProposalPreview {
  requestId: string;
  requester: RequesterRef;
  question: string;
  requestedStep: LadderStep;
  maxStep: LadderStep;
  item?: { title: string; kind: ItemKind; category: Category; date: number };
  options: StepOption[];
  rule: CategoryRule;
  warnings: Warning[];
  outcome: ProposalOutcome;
}

export type PageToExtension =
  | { type: 'sieve/hello'; version: 1; homeBase: boolean; appVersion: string }
  | { type: 'sieve/pending'; version: 1; proposals: ProposalPreview[] }   // the full current list every time: outside requests waiting for the person, oldest first, at most 20; re-sent every 20 s as a keepalive
  | { type: 'sieve/resolved'; version: 1; requestId: string; outcome: 'approved' | 'declined' | 'expired' | 'error' };  // 'error' only when nothing was written, so nothing was shared

export type ExtensionToPage =
  | { type: 'sieve/hello-ack'; version: 1; extensionVersion: string; shortcut?: string }   // shortcut: the open-sieve key binding from chrome.commands.getAll(), '' when unset (50 section 8.9)
  | { type: 'sieve/decision'; version: 1; decision: Decision }            // decidedBy must be 'extension'
  | { type: 'sieve/open-app'; version: 1; requestId?: string };
