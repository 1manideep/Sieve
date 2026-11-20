import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_BASE_PORT_NAME, MESSAGE_VERSION, type ProposalPreview } from '@sieve/shared';
import type { ExtensionStatus } from '@/state/homeBase';
import { createExtensionBridge, isExtensionToPage, type BridgeHandlers, type PortLike, type RuntimeLike } from './extensionBridge';

class FakePort implements PortLike {
  sent: unknown[] = [];
  disconnected = false;
  private msg: ((m: unknown) => void)[] = [];
  private disc: (() => void)[] = [];
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  disconnect() {
    this.disconnected = true;
  }
  onMessage = { addListener: (fn: (m: unknown) => void) => void this.msg.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disc.push(fn) };
  receive(m: unknown) {
    for (const fn of this.msg) fn(m);
  }
  drop() {
    for (const fn of this.disc) fn();
  }
  types() {
    return this.sent.map((m) => (m as { type: string }).type);
  }
}

function fakeRuntime() {
  const ports: FakePort[] = [];
  const connect = vi.fn((_id: string, _info: { name: string }) => {
    const p = new FakePort();
    ports.push(p);
    return p;
  });
  const runtime: RuntimeLike = { connect, lastError: undefined };
  return { runtime, ports, connect };
}

const ACK = { type: 'sieve/hello-ack', version: MESSAGE_VERSION, extensionVersion: '1.0.0' };
const preview = { requestId: 'r1' } as ProposalPreview;

function setup(opts: { runtime?: RuntimeLike | undefined } = {}) {
  const rt = fakeRuntime();
  const statuses: ExtensionStatus[] = [];
  const ticks: (() => void)[] = [];
  const h: BridgeHandlers = {
    onDecision: vi.fn(),
    onOpenApp: vi.fn(),
    onStatus: (s) => statuses.push(s),
    getPending: vi.fn(() => [preview]),
    onHello: vi.fn(),
  };
  const runtime = 'runtime' in opts ? opts.runtime : rt.runtime;
  const bridge = createExtensionBridge('extid', '0.1.0', h, {
    runtime: () => runtime,
    makeTicker: (onTick) => {
      ticks.push(onTick);
      const handle = setInterval(onTick, 20_000);
      return { stop: () => clearInterval(handle) };
    },
    homeBase: () => true,
    onFocus: () => () => undefined,
  });
  return { bridge, h, statuses, ...rt };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('extension bridge', () => {
  it('connects with the port name and sends hello with version 1', () => {
    const { bridge, connect, ports, statuses } = setup();
    bridge.start();
    expect(connect).toHaveBeenCalledWith('extid', { name: HOME_BASE_PORT_NAME });
    expect(ports[0].sent[0]).toEqual({ type: 'sieve/hello', version: 1, homeBase: true, appVersion: '0.1.0' });
    expect(statuses).toEqual(['connecting']);
  });

  it('after the ack: connected, the shortcut reported, and the full pending list at once', () => {
    const { bridge, ports, statuses, h } = setup();
    bridge.start();
    ports[0].receive(ACK);
    expect(h.onHello).toHaveBeenCalledWith({ extensionVersion: '1.0.0', extensionShortcut: '' });
    expect(statuses.at(-1)).toBe('connected');
    expect(ports[0].sent[1]).toEqual({ type: 'sieve/pending', version: 1, proposals: [preview] });
  });

  it('no ack within 2 s gives not-installed, and probes again later', () => {
    const { bridge, ports, statuses, connect } = setup();
    bridge.start();
    vi.advanceTimersByTime(2000);
    expect(statuses.at(-1)).toBe('not-installed');
    expect(ports[0].disconnected).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('without chrome.runtime it is not-installed', () => {
    const { bridge, statuses } = setup({ runtime: undefined });
    bridge.start();
    expect(statuses).toEqual(['not-installed']);
  });

  it('a disconnect after the ack reconnects at once, then after 2 s and 5 s', () => {
    const { bridge, ports, statuses, connect } = setup();
    bridge.start();
    ports[0].receive(ACK);
    ports[0].drop();
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(0);
    expect(connect).toHaveBeenCalledTimes(2);
    ports[1].drop();   // dropped before an ack
    vi.advanceTimersByTime(1999);
    expect(connect).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledTimes(3);
    ports[2].drop();
    vi.advanceTimersByTime(4999);
    expect(connect).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledTimes(4);
    ports[3].receive(ACK);   // a new ack resets the backoff
    expect(statuses.at(-1)).toBe('connected');
    ports[3].drop();
    vi.advanceTimersByTime(0);
    expect(connect).toHaveBeenCalledTimes(5);
  });

  it('resends the pending list every 20 s while connected', () => {
    const { bridge, ports } = setup();
    bridge.start();
    ports[0].receive(ACK);
    const pendings = () => ports[0].types().filter((t) => t === 'sieve/pending').length;
    expect(pendings()).toBe(1);
    vi.advanceTimersByTime(20_000);
    expect(pendings()).toBe(2);
    vi.advanceTimersByTime(40_000);
    expect(pendings()).toBe(4);
  });

  it('ignores invalid messages: wrong version, decidedBy app, unknown step, unknown type', () => {
    const { bridge, ports, h } = setup();
    bridge.start();
    ports[0].receive(ACK);
    const decision = { requestId: 'r1', approved: true, step: 'answer', itemIds: [], decidedBy: 'extension', decidedAt: 1 };
    ports[0].receive({ type: 'sieve/decision', version: 2, decision });
    ports[0].receive({ type: 'sieve/decision', version: 1, decision: { ...decision, decidedBy: 'app' } });
    ports[0].receive({ type: 'sieve/decision', version: 1, decision: { ...decision, step: 'everything' } });
    ports[0].receive({ type: 'sieve/whatever', version: 1 });
    ports[0].receive('not an object');
    expect(h.onDecision).not.toHaveBeenCalled();
  });

  it('forwards valid decisions and open-app', () => {
    const { bridge, ports, h } = setup();
    bridge.start();
    ports[0].receive(ACK);
    ports[0].receive({ type: 'sieve/decision', version: 1, decision: { requestId: 'r1', approved: true, step: 'excerpt', itemIds: [], decidedBy: 'extension', decidedAt: 5 } });
    expect(h.onDecision).toHaveBeenCalledWith({ requestId: 'r1', approved: true, step: 'excerpt', decidedBy: 'extension' });
    ports[0].receive({ type: 'sieve/decision', version: 1, decision: { requestId: 'r1', approved: false, itemIds: [], decidedBy: 'extension', decidedAt: 5 } });
    expect(h.onDecision).toHaveBeenLastCalledWith({ requestId: 'r1', approved: false, decidedBy: 'extension' });
    ports[0].receive({ type: 'sieve/open-app', version: 1, requestId: 'r1' });
    expect(h.onOpenApp).toHaveBeenCalledWith('r1');
  });

  it('ignores decisions before the ack', () => {
    const { bridge, ports, h } = setup();
    bridge.start();
    ports[0].receive({ type: 'sieve/decision', version: 1, decision: { requestId: 'r1', approved: true, step: 'answer', itemIds: [], decidedBy: 'extension', decidedAt: 5 } });
    expect(h.onDecision).not.toHaveBeenCalled();
  });

  it('onDisconnect firing twice is harmless', () => {
    const { bridge, ports, connect } = setup();
    bridge.start();
    ports[0].receive(ACK);
    ports[0].drop();
    ports[0].drop();
    vi.advanceTimersByTime(0);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('sends resolved only while connected; stop disconnects and goes idle', () => {
    const { bridge, ports, statuses } = setup();
    bridge.start();
    bridge.sendResolved('r1', 'approved');
    expect(ports[0].types()).toEqual(['sieve/hello']);
    ports[0].receive(ACK);
    bridge.sendResolved('r1', 'approved');
    expect(ports[0].sent.at(-1)).toEqual({ type: 'sieve/resolved', version: 1, requestId: 'r1', outcome: 'approved' });
    bridge.stop();
    expect(ports[0].disconnected).toBe(true);
    expect(statuses.at(-1)).toBe('idle');
  });
});

describe('isExtensionToPage', () => {
  it('accepts the three types and rejects the rest', () => {
    expect(isExtensionToPage(ACK)).toBe(true);
    expect(isExtensionToPage({ type: 'sieve/open-app', version: 1 })).toBe(true);
    expect(isExtensionToPage({ type: 'sieve/decision', version: 1, decision: { requestId: 'r', approved: true, itemIds: [], decidedBy: 'extension', decidedAt: 1 } })).toBe(true);
    expect(isExtensionToPage({ type: 'sieve/decision', version: 1, decision: { requestId: 'r', approved: true, itemIds: [3], decidedBy: 'extension', decidedAt: 1 } })).toBe(false);
    expect(isExtensionToPage({ type: 'sieve/decision', version: 1, decision: { requestId: 'r', approved: 'yes', itemIds: [], decidedBy: 'extension', decidedAt: 1 } })).toBe(false);
    expect(isExtensionToPage(null)).toBe(false);
  });
});
