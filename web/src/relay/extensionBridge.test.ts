import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_BASE_PORT_NAME, MESSAGE_VERSION, type ProposalPreview } from '@sieve/shared';
import type { ExtensionStatus } from '@/state/homeBase';
import { textHashOf } from './decision';
import { createExtensionBridge, isExtensionToPage, isOldExtension, previewsFor, type BridgeHandlers, type PortLike, type RuntimeLike } from './extensionBridge';

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

function setup(opts: { runtime?: RuntimeLike | undefined; pending?: ProposalPreview[] } = {}) {
  const rt = fakeRuntime();
  const statuses: ExtensionStatus[] = [];
  const ticks: (() => void)[] = [];
  const h: BridgeHandlers = {
    onDecision: vi.fn(),
    onOpenApp: vi.fn(),
    onStatus: (s) => statuses.push(s),
    getPending: vi.fn(() => opts.pending ?? [preview]),
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
    expect(ports[0].sent[1]).toEqual({ type: 'sieve/pending', version: 1, proposals: [{ ...preview, textHash: textHashOf(undefined) }] });
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

  it('forwards the text hash an approval carries (extension 0.1.1), and ignores a hash that is not a string', () => {
    const { bridge, ports, h } = setup();
    bridge.start();
    ports[0].receive(ACK);
    const decision = { requestId: 'r1', approved: true, step: 'answer', itemIds: [], decidedBy: 'extension', decidedAt: 5 };
    ports[0].receive({ type: 'sieve/decision', version: 1, decision, textHash: '0a1b2c3d4e5f6789' });
    expect(h.onDecision).toHaveBeenCalledWith({ requestId: 'r1', approved: true, step: 'answer', decidedBy: 'extension', textHash: '0a1b2c3d4e5f6789' });
    ports[0].receive({ type: 'sieve/decision', version: 1, decision, textHash: 42 });
    expect(h.onDecision).toHaveBeenCalledTimes(1);
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

describe('previews for the extension version (0.1.0 dropped a whole list over one unknown value)', () => {
  const ready = (changes: Partial<ProposalPreview> = {}): ProposalPreview => ({
    requestId: 'r1',
    requester: { kind: 'outside', grantId: 'g', aiName: 'Test assistant' },
    question: 'q',
    requestedStep: 'answer',
    maxStep: 'full',
    item: { title: 't', kind: 'email', category: 'Home', date: 1 },
    options: [
      { step: 'answer', text: 'a', chars: 1, redactions: 0, available: true },
      { step: 'excerpt', text: 'b', chars: 1, redactions: 0, available: true },
      { step: 'full', text: 'c', chars: 1, redactions: 0, available: true },
    ],
    rule: 'approve',
    warnings: [],
    outcome: 'ready',
    ...changes,
  });

  it('reads 0.1.0, and anything that is not a version, as old; 0.1.1 and later as new', () => {
    for (const v of ['0.1.0', '0.0.9', '', 'dev', '1']) expect(isOldExtension(v)).toBe(true);
    for (const v of ['0.1.1', '0.1.12', '0.2.0', '1.0.0', '0.1.1-beta']) expect(isOldExtension(v)).toBe(false);
  });

  it('every preview carries the hash of its option texts', () => {
    const p = ready();
    expect(previewsFor([p], '0.1.1')).toEqual([{ ...p, textHash: textHashOf(p.options) }]);
  });

  it('a 0.1.0 extension gets only the values every 0.1.0 build knows; 0.1.1 gets the list as it is', () => {
    const list = [
      ready({ requestId: 'r1', warnings: [{ kind: 'injection', message: 'm' }, { kind: 'new-kind' as never, message: 'n' }] }),
      ready({ requestId: 'r2', outcome: 'unsupported' }),     // came after some 0.1.0 builds
      ready({ requestId: 'r3', rule: 'sometimes' as never }),
      ready({ requestId: 'r4', item: { title: 't', kind: 'calendar' as never, category: 'Home', date: 1 } }),
      ready({ requestId: 'r5', item: { title: 't', kind: 'email', category: 'Pets' as never, date: 1 } }),
      ready({ requestId: 'r6', outcome: 'no-match' }),
    ];
    const old = previewsFor(list, '0.1.0');
    expect(old.map((p) => p.requestId)).toEqual(['r1', 'r6']);
    expect(old[0]!.warnings).toEqual([{ kind: 'injection', message: 'm' }]);
    expect(previewsFor(list, '0.1.1').map((p) => p.requestId)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    expect(previewsFor(list, '0.1.1')[0]!.warnings).toHaveLength(2);
  });

  it('the bridge trims for the version in the hello-ack', () => {
    const list = [ready({ requestId: 'r1' }), ready({ requestId: 'r2', outcome: 'unsupported' })];
    for (const [version, ids] of [['0.1.0', ['r1']], ['0.1.1', ['r1', 'r2']]] as const) {
      const { bridge, ports } = setup({ pending: list });
      bridge.start();
      ports[0].receive({ ...ACK, extensionVersion: version });
      const sent = ports[0].sent[1] as { proposals: ProposalPreview[] };
      expect(sent.proposals.map((p) => p.requestId)).toEqual(ids);
      bridge.stop();
    }
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
