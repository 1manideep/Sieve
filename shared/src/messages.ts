// Page-to-extension messages (docs/spec/01-contracts.md section 6).
// Transport: chrome.runtime.connect(EXTENSION_ID, { name: HOME_BASE_PORT_NAME }). Every message carries
// version: MESSAGE_VERSION; unknown types or versions are ignored.
import type { AutoWait } from './copy';
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
  /** Auto-approve is on for this connection, and this is why the request still waits for the person (since Nov 23). */
  autoWaits?: AutoWait;
}

/**
 * A request the home base is still preparing (since Nov 23; an extension that does not know the field ignores it).
 * Never any content: the question as asked, and the pipeline's running label of the step it is on.
 */
export interface PreparingPreview {
  requestId: string;
  aiName: string;
  question: string;
  label?: string;            // the step it is on, e.g. "Reading 3 emails with the on-device model…"; none before the first step
  elapsedMs: number;         // since the assistant asked
  auto?: true;               // auto-approve will send the answer without asking the person
  wait?: 'click' | 'hidden'; // why it is slow: the tab waits for a first click, or the tab is in the background
}

export type PageToExtension =
  | { type: 'sieve/hello'; version: 1; homeBase: boolean; appVersion: string }
  // the full current list every time: outside requests waiting for the person (and those whose decision is being
  // written), oldest first, at most 20; re-sent every 20 s as a keepalive. Since Nov 23 also the requests still being
  // prepared, and gmail: 'ended' while Gmail access on that computer has run out.
  | { type: 'sieve/pending'; version: 1; proposals: ProposalPreview[]; preparing?: PreparingPreview[]; gmail?: 'ended' }
  // 'error' only when nothing was written, so nothing was shared; since Nov 23 with the app's one-line reason
  | { type: 'sieve/resolved'; version: 1; requestId: string; outcome: 'approved' | 'declined' | 'expired' | 'error'; message?: string };

export type ExtensionToPage =
  | { type: 'sieve/hello-ack'; version: 1; extensionVersion: string; shortcut?: string }   // shortcut: the open-sieve key binding from chrome.commands.getAll(), '' when unset (50 section 8.9)
  | { type: 'sieve/decision'; version: 1; decision: Decision }            // decidedBy must be 'extension'
  | { type: 'sieve/open-app'; version: 1; requestId?: string };
