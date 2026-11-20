// The test request (50 sections 11 and 13.3): one made-up preview through the bridge's pending list, its decision
// answered here and never handed to the engine, and the entry gone after a decision or 2 minutes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LADDER_STEPS, MESSAGE_VERSION, type ProposalPreview } from '@sieve/shared';
import { TEST_REQUEST } from '@/copy/screens-controls';
import type { ExtensionStatus } from '@/state/homeBase';
import type { DecisionInput } from './decision';
import { createExtensionBridge, type BridgeHandlers, type ExtensionBridge, type PortLike } from './extensionBridge';
import {
  TEST_GRANT_ID,
  TEST_REQUEST_PREFIX,
  TEST_REQUEST_TTL_MS,
  buildTestPreview,
  createTestRequests,
  type TestRequestDeps,
} from './testRequest';

const REAL: ProposalPreview = { ...buildTestPreview('real-1', 1), requestId: 'Xq81real', requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' } };

/** The engine's side of the bridge: what the wrapped handlers forward to. */
function engineHandlers() {
  return {
    onDecision: vi.fn<(input: DecisionInput) => void>(),
    onOpenApp: vi.fn<(requestId?: string) => void>(),
    onStatus: vi.fn<(s: ExtensionStatus) => void>(),
    getPending: vi.fn<() => ProposalPreview[]>(() => [REAL]),
  } satisfies BridgeHandlers;
}

/** A fake bridge: records what the module asks it to post, and exposes the handlers it was built with. */
function fakeBridge() {
  let handlers: BridgeHandlers | undefined;
  const bridge = {
    start: vi.fn(),
    stop: vi.fn(),
    sendPending: vi.fn(),
    sendResolved: vi.fn<ExtensionBridge['sendResolved']>(),
  } satisfies ExtensionBridge;
  const make = vi.fn((h: BridgeHandlers) => {
    handlers = h;
    return bridge;
  });
  return {
    bridge,
    make,
    get handlers(): BridgeHandlers {
      if (!handlers) throw new Error('bridge not made');
      return handlers;
    },
  };
}

function setup(over: Partial<TestRequestDeps> = {}) {
  let n = 0;
  const requests = createTestRequests({ now: () => 1_000, newId: () => `id${++n}`, ...over });
  const engine = engineHandlers();
  const fake = fakeBridge();
  const made = requests.wrapMakeBridge(fake.make)(engine);
  return { requests, engine, fake, made };
}

const testIds = (list: ProposalPreview[]) => list.filter((p) => p.requestId.startsWith(TEST_REQUEST_PREFIX)).map((p) => p.requestId);

afterEach(() => {
  vi.useRealTimers();
});

describe('buildTestPreview', () => {
  it('is a made-up request from "Test" with the answer step only and outcome ready', () => {
    const p = buildTestPreview('test-abc', 42);
    expect(p).toEqual({
      requestId: 'test-abc',
      requester: { kind: 'outside', grantId: TEST_GRANT_ID, aiName: 'Test' },
      question: TEST_REQUEST.question,
      requestedStep: 'answer',
      maxStep: 'answer',
      item: { title: TEST_REQUEST.itemTitle, kind: 'note', category: 'Personal', date: 42 },
      options: [
        { step: 'answer', text: TEST_REQUEST.answer, chars: TEST_REQUEST.answer.length, redactions: 0, available: true },
        { step: 'excerpt', text: '', chars: 0, redactions: 0, available: false, unavailableReason: TEST_REQUEST.onlyAnswer },
        { step: 'full', text: '', chars: 0, redactions: 0, available: false, unavailableReason: TEST_REQUEST.onlyAnswer },
      ],
      rule: 'approve',
      warnings: [],
      outcome: 'ready',
    });
    expect(p.options.map((o) => o.step)).toEqual([...LADDER_STEPS]);
  });

  it('uses an id the extension accepts (50 section 6.6)', () => {
    const { requests, fake } = setup({ newId: () => crypto.randomUUID() });
    fake.handlers.onStatus('connected');
    requests.send();
    const [id] = testIds(fake.handlers.getPending());
    expect(id).toMatch(/^test-[A-Za-z0-9_-]{1,123}$/);
  });
});

describe('createTestRequests', () => {
  it('cannot send without a connected bridge', () => {
    const lonely = createTestRequests();
    expect(lonely.canSend()).toBe(false);
    expect(lonely.send()).toBe(false);
    expect(lonely.getState()).toEqual({ kind: 'unavailable' });

    const { requests, fake } = setup();
    expect(requests.send()).toBe(false);
    fake.handlers.onStatus('connecting');
    expect(requests.canSend()).toBe(false);
    expect(requests.send()).toBe(false);
    expect(fake.bridge.sendPending).not.toHaveBeenCalled();
  });

  it('passes status, open-app and pending through to the engine unchanged', () => {
    const { requests, engine, fake, made } = setup();
    expect(made).toBe(fake.bridge);
    fake.handlers.onStatus('connected');
    expect(engine.onStatus).toHaveBeenCalledWith('connected');
    expect(requests.canSend()).toBe(true);
    fake.handlers.onOpenApp('Xq81real');
    expect(engine.onOpenApp).toHaveBeenCalledWith('Xq81real');
    expect(fake.handlers.getPending()).toEqual([REAL]);
    fake.handlers.onStatus('reconnecting');
    expect(requests.canSend()).toBe(false);
  });

  it('sends one preview after the real ones and posts the list', () => {
    const { requests, fake } = setup();
    const seen = vi.fn();
    requests.subscribe(seen);
    fake.handlers.onStatus('connected');
    expect(requests.send()).toBe(true);
    expect(requests.getState()).toEqual({ kind: 'sent', requestId: 'test-id1', expiresAt: 1_000 + TEST_REQUEST_TTL_MS });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(fake.bridge.sendPending).toHaveBeenCalledTimes(1);
    const list = fake.handlers.getPending();
    expect(list.map((p) => p.requestId)).toEqual(['Xq81real', 'test-id1']);
    expect(list[1]).toEqual(buildTestPreview('test-id1', 1_000));
  });

  it.each([
    [true, 'approved'],
    [false, 'declined'],
  ] as const)('answers the side panel (approved %s) and removes the entry, without the engine', (approved, outcome) => {
    const { requests, engine, fake } = setup();
    fake.handlers.onStatus('connected');
    requests.send();
    fake.bridge.sendPending.mockClear();
    fake.handlers.onDecision({ requestId: 'test-id1', approved, ...(approved ? { step: 'answer' as const } : {}), decidedBy: 'extension' });
    expect(requests.getState()).toEqual({ kind: 'answered', requestId: 'test-id1', approved });
    expect(fake.bridge.sendResolved).toHaveBeenCalledWith('test-id1', outcome);
    expect(fake.bridge.sendPending).toHaveBeenCalledTimes(1);
    expect(testIds(fake.handlers.getPending())).toEqual([]);
    expect(engine.onDecision).not.toHaveBeenCalled();
  });

  it('hands real decisions to the engine', () => {
    const { requests, engine, fake } = setup();
    fake.handlers.onStatus('connected');
    requests.send();
    const input: DecisionInput = { requestId: 'Xq81real', approved: true, step: 'excerpt', decidedBy: 'extension' };
    fake.handlers.onDecision(input);
    expect(engine.onDecision).toHaveBeenCalledWith(input);
    expect(requests.getState().kind).toBe('sent');
  });

  it('refuses an approval above the answer step and keeps waiting', () => {
    const { requests, fake } = setup();
    fake.handlers.onStatus('connected');
    requests.send();
    fake.handlers.onDecision({ requestId: 'test-id1', approved: true, step: 'full', decidedBy: 'extension' });
    expect(fake.bridge.sendResolved).toHaveBeenCalledWith('test-id1', 'error');
    expect(requests.getState().kind).toBe('sent');
    expect(testIds(fake.handlers.getPending())).toEqual(['test-id1']);
  });

  it('expires the entry after 2 minutes', () => {
    vi.useFakeTimers();
    const { requests, fake } = setup();
    fake.handlers.onStatus('connected');
    requests.send();
    vi.advanceTimersByTime(TEST_REQUEST_TTL_MS - 1);
    expect(testIds(fake.handlers.getPending())).toEqual(['test-id1']);
    vi.advanceTimersByTime(1);
    expect(requests.getState()).toEqual({ kind: 'expired', requestId: 'test-id1' });
    expect(fake.bridge.sendResolved).toHaveBeenCalledWith('test-id1', 'expired');
    expect(testIds(fake.handlers.getPending())).toEqual([]);
  });

  it('replaces a waiting entry when sent again; the old id only resends the list', () => {
    vi.useFakeTimers();
    const { requests, engine, fake } = setup();
    fake.handlers.onStatus('connected');
    requests.send();
    vi.advanceTimersByTime(60_000);
    requests.send();
    expect(testIds(fake.handlers.getPending())).toEqual(['test-id2']);
    fake.bridge.sendPending.mockClear();
    fake.handlers.onDecision({ requestId: 'test-id1', approved: false, decidedBy: 'extension' });
    expect(fake.bridge.sendPending).toHaveBeenCalledTimes(1);
    expect(fake.bridge.sendResolved).not.toHaveBeenCalled();
    expect(engine.onDecision).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(requests.getState()).toEqual({ kind: 'sent', requestId: 'test-id2', expiresAt: 1_000 + TEST_REQUEST_TTL_MS });
    vi.advanceTimersByTime(60_000);
    expect(requests.getState()).toEqual({ kind: 'expired', requestId: 'test-id2' });
  });

  it('reset drops the entry quietly', () => {
    const { requests, fake } = setup();
    fake.handlers.onStatus('connected');
    requests.send();
    requests.reset();
    expect(requests.getState()).toEqual({ kind: 'idle' });
    expect(testIds(fake.handlers.getPending())).toEqual([]);
    expect(fake.bridge.sendResolved).not.toHaveBeenCalled();
  });

  it('keeps the engine bridge off when the factory makes none', () => {
    const requests = createTestRequests();
    expect(requests.wrapMakeBridge(() => null)(engineHandlers())).toBeNull();
    expect(requests.send()).toBe(false);
  });
});

describe('through the real bridge', () => {
  class Port implements PortLike {
    sent: { type: string; proposals?: ProposalPreview[]; requestId?: string; outcome?: string }[] = [];
    private listeners: ((m: unknown) => void)[] = [];
    postMessage(m: unknown) {
      this.sent.push(m as Port['sent'][number]);
    }
    disconnect() {}
    onMessage = { addListener: (fn: (m: unknown) => void) => void this.listeners.push(fn) };
    onDisconnect = { addListener: () => undefined };
    receive(m: unknown) {
      for (const fn of this.listeners) fn(m);
    }
  }

  it('posts the test preview in sieve/pending and answers its decision with sieve/resolved', () => {
    const port = new Port();
    const requests = createTestRequests({ now: () => 5, newId: () => 'one' });
    const engine = engineHandlers();
    const make = requests.wrapMakeBridge((h) =>
      createExtensionBridge('abcdefghijklmnopabcdefghijklmnop', '1.0.0', h, {
        runtime: () => ({ connect: () => port }),
        makeTicker: () => ({ stop: () => undefined }),
        onFocus: () => () => undefined,
      }),
    );
    const bridge = make(engine);
    bridge?.start();
    port.receive({ type: 'sieve/hello-ack', version: MESSAGE_VERSION, extensionVersion: '1.0.0' });
    expect(engine.onStatus).toHaveBeenLastCalledWith('connected');

    expect(requests.send()).toBe(true);
    const pending = port.sent.filter((m) => m.type === 'sieve/pending');
    expect(pending.at(-1)?.proposals?.map((p) => p.requestId)).toEqual(['Xq81real', 'test-one']);

    port.receive({
      type: 'sieve/decision',
      version: MESSAGE_VERSION,
      decision: { requestId: 'test-one', approved: true, step: 'answer', itemIds: [], decidedBy: 'extension', decidedAt: 9 },
    });
    expect(port.sent.at(-2)).toEqual({ type: 'sieve/resolved', version: MESSAGE_VERSION, requestId: 'test-one', outcome: 'approved' });
    expect(port.sent.at(-1)?.proposals?.map((p) => p.requestId)).toEqual(['Xq81real']);
    expect(engine.onDecision).not.toHaveBeenCalled();
    expect(requests.getState()).toEqual({ kind: 'answered', requestId: 'test-one', approved: true });
    bridge?.stop();
  });
});
