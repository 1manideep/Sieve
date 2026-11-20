// The Playground tab's one port (50 sections 6.2 and 11): opened on mount, shared with the relay engine when it
// runs, carrying the test request, and closed when the last starter stops.
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_VERSION, type ProposalPreview } from '@sieve/shared';
import type { DecisionInput } from './decision';
import { createExtensionBridge, type BridgeHandlers, type ExtensionBridge, type PortLike } from './extensionBridge';
import { createPlaygroundBridge } from './playgroundBridge';
import { buildTestPreview, createTestRequests } from './testRequest';

const PREVIEW: ProposalPreview = { ...buildTestPreview('x', 1), requestId: 'Pg01relay', requester: { kind: 'outside', grantId: 'pg', aiName: 'Gemini in the cloud' } };

/** A fake port: records what the page posts, and lets a test play the extension. */
class Port implements PortLike {
  sent: { type: string; proposals?: ProposalPreview[]; requestId?: string; outcome?: string }[] = [];
  disconnected = false;
  private listeners: ((m: unknown) => void)[] = [];
  postMessage(m: unknown) {
    this.sent.push(m as Port['sent'][number]);
  }
  disconnect() {
    this.disconnected = true;
  }
  onMessage = { addListener: (fn: (m: unknown) => void) => void this.listeners.push(fn) };
  onDisconnect = { addListener: () => undefined };
  receive(m: unknown) {
    for (const fn of this.listeners) fn(m);
  }
  ack() {
    this.receive({ type: 'sieve/hello-ack', version: MESSAGE_VERSION, extensionVersion: '1.0.0', shortcut: 'Alt+S' });
  }
  pending(): string[][] {
    return this.sent.filter((m) => m.type === 'sieve/pending').map((m) => (m.proposals ?? []).map((p) => p.requestId));
  }
}

function engineHandlers(pending: ProposalPreview[] = [PREVIEW]) {
  return {
    onDecision: vi.fn<(input: DecisionInput) => void>(),
    onOpenApp: vi.fn<(requestId?: string) => void>(),
    onStatus: vi.fn(),
    onHello: vi.fn(),
    getPending: vi.fn(() => pending),
  } satisfies BridgeHandlers;
}

/** The real page bridge over a fake port, wrapped by a test-request module as the app wires it. */
function setup() {
  const ports: Port[] = [];
  const requests = createTestRequests({ now: () => 5, newId: () => 'one' });
  const pg = createPlaygroundBridge(
    requests.wrapMakeBridge((h) => {
      const port = new Port();
      ports.push(port);
      return createExtensionBridge('abcdefghijklmnopabcdefghijklmnop', '1.0.0', h, {
        runtime: () => ({ connect: () => port }),
        makeTicker: () => ({ stop: () => undefined }),
        onFocus: () => () => undefined,
      });
    }),
  );
  return { pg, requests, ports, port: () => ports[ports.length - 1] as Port };
}

describe('createPlaygroundBridge', () => {
  it('is off without an extension id: nothing opens, the engine gets no bridge, the status stays off', () => {
    const pg = createPlaygroundBridge(null);
    const stop = pg.start();
    expect(pg.status()).toBe('off');
    expect(pg.makeEngineBridge(engineHandlers())).toBeNull();
    stop();
    expect(pg.status()).toBe('off');
  });

  it('opens one port on start, reports its status, and closes it when the last starter stops', () => {
    const { pg, ports, port } = setup();
    const seen = vi.fn();
    pg.subscribe(seen);
    const stopA = pg.start();
    const stopB = pg.start();          // a second starter (StrictMode, a second mount) shares the port
    expect(ports).toHaveLength(1);
    expect(pg.status()).toBe('connecting');
    port().ack();
    expect(pg.status()).toBe('connected');
    expect(seen).toHaveBeenCalledTimes(2);
    expect(port().pending()).toEqual([[]]);
    stopA();
    expect(port().disconnected).toBe(false);
    stopB();
    expect(port().disconnected).toBe(true);
    expect(pg.status()).toBe('idle');
  });

  it('carries the test request: the page sends it, the panel answers it, the extension sees the empty list again', () => {
    const { pg, requests, port } = setup();
    pg.start();
    expect(requests.canSend()).toBe(false);
    port().ack();
    expect(requests.canSend()).toBe(true);
    expect(requests.send()).toBe(true);
    expect(port().pending().at(-1)).toEqual(['test-one']);
    port().receive({
      type: 'sieve/decision',
      version: MESSAGE_VERSION,
      decision: { requestId: 'test-one', approved: true, step: 'answer', itemIds: [], decidedBy: 'extension', decidedAt: 9 },
    });
    expect(requests.getState()).toEqual({ kind: 'answered', requestId: 'test-one', approved: true });
    expect(port().sent.at(-2)).toEqual({ type: 'sieve/resolved', version: MESSAGE_VERSION, requestId: 'test-one', outcome: 'approved' });
    expect(port().pending().at(-1)).toEqual([]);
  });

  it('the relay engine attaches to the same port: its status, hello, pending list and decisions flow through it', () => {
    const { pg, requests, ports, port } = setup();
    pg.start();
    port().ack();
    const h = engineHandlers();
    const engineBridge = pg.makeEngineBridge(h);
    expect(engineBridge).not.toBeNull();
    engineBridge?.start();
    expect(ports).toHaveLength(1);
    expect(h.onStatus).toHaveBeenCalledWith('connected');
    expect(h.onHello).toHaveBeenCalledWith({ extensionVersion: '1.0.0', extensionShortcut: 'Alt+S' });
    expect(port().pending().at(-1)).toEqual(['Pg01relay']);

    // The test request sits after the engine's own entries, and its decision never reaches the engine.
    requests.send();
    expect(port().pending().at(-1)).toEqual(['Pg01relay', 'test-one']);
    port().receive({ type: 'sieve/decision', version: MESSAGE_VERSION, decision: { requestId: 'test-one', approved: false, itemIds: [], decidedBy: 'extension', decidedAt: 9 } });
    expect(h.onDecision).not.toHaveBeenCalled();
    port().receive({ type: 'sieve/decision', version: MESSAGE_VERSION, decision: { requestId: 'Pg01relay', approved: true, step: 'answer', itemIds: [], decidedBy: 'extension', decidedAt: 9 } });
    expect(h.onDecision).toHaveBeenCalledWith({ requestId: 'Pg01relay', approved: true, step: 'answer', decidedBy: 'extension' });
    port().receive({ type: 'sieve/open-app', version: MESSAGE_VERSION, requestId: 'Pg01relay' });
    expect(h.onOpenApp).toHaveBeenCalledWith('Pg01relay');

    engineBridge?.sendResolved('Pg01relay', 'approved');
    expect(port().sent.at(-1)).toEqual({ type: 'sieve/resolved', version: MESSAGE_VERSION, requestId: 'Pg01relay', outcome: 'approved' });

    // Stopping the engine's bridge empties the list at once and leaves the port open for the page.
    engineBridge?.stop();
    expect(port().pending().at(-1)).toEqual([]);
    expect(port().disconnected).toBe(false);
    port().receive({ type: 'sieve/decision', version: MESSAGE_VERSION, decision: { requestId: 'Pg01relay', approved: true, step: 'answer', itemIds: [], decidedBy: 'extension', decidedAt: 9 } });
    expect(h.onDecision).toHaveBeenCalledTimes(1);
  });

  it('an engine that starts before the port is open hears the status once it connects', () => {
    const { pg, port } = setup();
    const h = engineHandlers();
    const engineBridge = pg.makeEngineBridge(h);
    engineBridge?.start();
    expect(h.onStatus).toHaveBeenLastCalledWith('off');
    pg.start();
    expect(h.onStatus).toHaveBeenLastCalledWith('connecting');
    port().ack();
    expect(h.onStatus).toHaveBeenLastCalledWith('connected');
    expect(port().pending().at(-1)).toEqual(['Pg01relay']);
  });

  it('never throws to the page when a listener or the engine throws', () => {
    const { pg, port } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pg.subscribe(() => {
      throw new Error('listener');
    });
    const h = engineHandlers();
    h.onStatus.mockImplementation(() => {
      throw new Error('engine');
    });
    pg.makeEngineBridge(h)?.start();
    expect(() => pg.start()).not.toThrow();
    expect(() => port().ack()).not.toThrow();
    expect(pg.status()).toBe('connected');
    error.mockRestore();
  });

  it('a second wrapped bridge (the Google session) can carry the same test request', () => {
    const { pg, requests, port } = setup();
    const other = { start: vi.fn(), stop: vi.fn(), sendPending: vi.fn(), sendResolved: vi.fn() } satisfies ExtensionBridge;
    let otherHandlers: BridgeHandlers | undefined;
    requests.wrapMakeBridge((h) => {
      otherHandlers = h;
      return other;
    })(engineHandlers([]));
    pg.start();
    port().ack();
    requests.send();
    expect(other.sendPending).not.toHaveBeenCalled();   // not started: it carries nothing
    otherHandlers?.onStatus('connected');
    expect(otherHandlers?.getPending().map((p) => p.requestId)).toEqual(['test-one']);
    otherHandlers?.onDecision({ requestId: 'test-one', approved: true, step: 'answer', decidedBy: 'extension' });
    expect(other.sendResolved).toHaveBeenCalledWith('test-one', 'approved');
    expect(port().sent.filter((m) => m.type === 'sieve/resolved')).toHaveLength(1);
    expect(requests.getState().kind).toBe('answered');
  });
});
