// The test request (50 sections 11 and 13.3, 60 section 7.2): one made-up proposal sent to the Sieve extension
// through the bridge's pending list, so judges and Web Store reviewers can try the side panel without an MCP client.
// Nothing is written to Firestore, there is no relay request and no receipt: the decision only comes back to this
// module, which answers the extension with sieve/resolved and drops the entry. An unanswered entry leaves after 2 min.
//
// The hook is the bridge's own handler interface (40 section 11.10): wrapMakeBridge() wraps a bridge factory, adding
// the test preview to getPending() and taking decisions for test ids out of onDecision(). Two factories are wrapped:
// the home base engine's (app/googleSession.ts, the Settings button) and the Playground tab's (relay/playgroundBridge.ts,
// the Playground button); every started bridge carries the entry, and the send needs one that is connected.
import { LADDER_STEPS, type LadderStep, type ProposalPreview, type StepOption } from '@sieve/shared';
import { TEST_REQUEST } from '@/copy/screens-controls';
import type { ExtensionStatus } from '@/state/homeBase';
import type { DecisionInput } from './decision';
import type { BridgeHandlers, ExtensionBridge } from './extensionBridge';

export const TEST_REQUEST_PREFIX = 'test-';
export const TEST_REQUEST_TTL_MS = 120_000;
/** The made-up grant id of the requester; no grant with this id exists anywhere. */
export const TEST_GRANT_ID = 'test-request';

export type TestRequestState =
  | { kind: 'idle' }
  | { kind: 'sent'; requestId: string; expiresAt: number }
  | { kind: 'answered'; requestId: string; approved: boolean }
  | { kind: 'expired'; requestId: string }
  | { kind: 'unavailable' };                       // send was pressed, but no connected bridge was there to carry it

type MakeBridge = (handlers: BridgeHandlers) => ExtensionBridge | null;

export interface TestRequestDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
  newId(): string;
}

export interface TestRequests {
  getState(): TestRequestState;
  subscribe(listener: () => void): () => void;
  /** True while a wrapped bridge is started and its extension is connected. */
  canSend(): boolean;
  /** Puts one test preview in the pending list and posts it. False (state 'unavailable') when no bridge is connected. */
  send(): boolean;
  /** Wraps a bridge factory (the engine's makeBridge, the Playground tab's), so the bridges it builds carry the test request. */
  wrapMakeBridge(make: MakeBridge): MakeBridge;
  /** Drops the waiting entry without telling the extension, and returns to 'idle'. */
  reset(): void;
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function option(step: LadderStep): StepOption {
  if (step === 'answer') {
    const text = TEST_REQUEST.answer;
    return { step, text, chars: text.length, redactions: 0, available: true };
  }
  return { step, text: '', chars: 0, redactions: 0, available: false, unavailableReason: TEST_REQUEST.onlyAnswer };
}

/** The made-up preview: requester "Test", a note that does not exist, the answer step only, outcome 'ready'. */
export function buildTestPreview(requestId: string, now: number): ProposalPreview {
  return {
    requestId,
    requester: { kind: 'outside', grantId: TEST_GRANT_ID, aiName: TEST_REQUEST.aiName },
    question: TEST_REQUEST.question,
    requestedStep: 'answer',
    maxStep: 'answer',
    item: { title: TEST_REQUEST.itemTitle, kind: 'note', category: 'Personal', date: now },
    options: LADDER_STEPS.map(option),
    rule: 'approve',
    warnings: [],
    outcome: 'ready',
  };
}

export function createTestRequests(overrides: Partial<TestRequestDeps> = {}): TestRequests {
  const deps: TestRequestDeps = {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
    newId: defaultId,
    ...overrides,
  };

  let state: TestRequestState = { kind: 'idle' };
  /** Every started wrapped bridge with the status it last reported; a bridge leaves when it reports 'idle' (stopped). */
  const bridges = new Map<ExtensionBridge, ExtensionStatus>();
  let current: { requestId: string; preview: ProposalPreview; timer: ReturnType<typeof setTimeout> } | null = null;
  const issued = new Set<string>();
  const listeners = new Set<() => void>();

  const connected = (): ExtensionBridge | null => {
    for (const [bridge, status] of bridges) if (status === 'connected') return bridge;
    return null;
  };
  /** The list changed: every started bridge posts it (a no-op on a bridge that is not connected). */
  const sendPendingAll = () => {
    for (const bridge of bridges.keys()) bridge.sendPending();
  };
  const sendResolvedAll = (requestId: string, outcome: 'approved' | 'declined' | 'expired' | 'error') => {
    for (const bridge of bridges.keys()) bridge.sendResolved(requestId, outcome);
  };

  const setState = (next: TestRequestState) => {
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('test request listener', error);
      }
    }
  };

  /** Ends the waiting entry: tells the extension how it ended, then posts the list without it. */
  const finish = (outcome: 'approved' | 'declined' | 'expired', next: TestRequestState) => {
    if (!current) return;
    const { requestId, timer } = current;
    deps.clearTimer(timer);
    current = null;
    sendResolvedAll(requestId, outcome);
    sendPendingAll();
    setState(next);
  };

  const decide = (input: DecisionInput) => {
    if (!current || input.requestId !== current.requestId) {
      // An older test entry: like the engine's not-pending, just resend the list.
      sendPendingAll();
      return;
    }
    if (input.approved && input.step !== 'answer') {
      // Only the answer is offered; anything else changes nothing and the entry keeps waiting (40 section 11.10).
      sendResolvedAll(current.requestId, 'error');
      sendPendingAll();
      return;
    }
    const requestId = current.requestId;
    finish(input.approved ? 'approved' : 'declined', { kind: 'answered', requestId, approved: input.approved });
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    canSend: () => connected() !== null,

    send() {
      if (!connected()) {
        setState({ kind: 'unavailable' });
        return false;
      }
      // A second press replaces the waiting entry; the next list simply leaves the old one out.
      if (current) deps.clearTimer(current.timer);
      const now = deps.now();
      const requestId = `${TEST_REQUEST_PREFIX}${deps.newId()}`;
      const timer = deps.setTimer(() => {
        if (current?.requestId === requestId) finish('expired', { kind: 'expired', requestId });
      }, TEST_REQUEST_TTL_MS);
      current = { requestId, preview: buildTestPreview(requestId, now), timer };
      issued.add(requestId);
      setState({ kind: 'sent', requestId, expiresAt: now + TEST_REQUEST_TTL_MS });
      sendPendingAll();
      return true;
    },

    wrapMakeBridge(make) {
      return (handlers) => {
        let self: ExtensionBridge | null = null;
        let status: ExtensionStatus = 'idle';
        // 'idle' is a bridge before start() and after stop(): it carries nothing until it reports a real status.
        const track = (s: ExtensionStatus) => {
          status = s;
          if (!self) return;
          if (s === 'idle') bridges.delete(self);
          else bridges.set(self, s);
        };
        const wrapped: BridgeHandlers = {
          ...handlers,
          onStatus: (s) => {
            track(s);
            handlers.onStatus(s);
          },
          getPending: () => {
            const real = handlers.getPending();
            return current ? [...real, current.preview] : real;
          },
          onDecision: (input) => {
            if (issued.has(input.requestId)) decide(input);
            else handlers.onDecision(input);
          },
        };
        const made = make(wrapped);
        self = made;
        if (made) track(status);
        return made;
      };
    },

    reset() {
      if (current) deps.clearTimer(current.timer);
      current = null;
      setState({ kind: 'idle' });
    },
  };
}

/** The one instance the app uses: googleSession and playgroundBridge wrap their bridges with it; Settings and the Playground send through it. */
export const testRequests: TestRequests = createTestRequests();
