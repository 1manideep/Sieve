import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATEGORIES,
  DEFAULT_CATEGORY_RULES,
  LADDER_STEPS,
  type Decision,
  type IndexRecord,
  type Proposal,
  type Receipt,
  type RelayPayload,
  type Settings,
  type StepOption,
} from '@sieve/shared';
import type { PrepareInput } from '@/pipeline';
import type { SieveDb } from '@/index';
import type { BlockedEntry } from '@/app/services/blocked';
import type { HomeBaseState } from '@/state/homeBase';
import type { RelayRequestView } from '@/state/types';
import { DECIDE_ERRORS, HOME_BASE, SEND_CHECK } from '@/copy/strings';
import { compose, option, proposal, request, T0 } from './__tests__/fixtures';
import type { BridgeHandlers, ExtensionBridge } from './extensionBridge';
import { createHomeBaseEngine, type EngineDeps, type HomeBaseEngine } from './homeBaseEngine';
import type { LockHandlers } from './homeBaseLock';
import { MSG } from './messagesToAi';
import type { FinishInput } from './requests';

const SETTINGS: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };

function record(id: string, over: Partial<IndexRecord> = {}): IndexRecord {
  return {
    id, source: id.split(':')[0] as IndexRecord['source'], sourceRef: id.split(':')[1], kind: 'email', title: 'Re: Deposit',
    date: T0, preview: '', category: 'Home', categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: T0,
    contentHash: 'h', version: 1, ...over,
  };
}

/** finalizeDecision as 10 section 12.9 describes it (pure; throws DecisionError). */
async function fakeFinalize(p: Proposal, d: Decision, extras?: { relatedOptions?: Record<string, StepOption[]> }) {
  const base = { id: crypto.randomUUID(), requestId: p.requestId, requester: p.requester, question: p.question, createdAt: d.decidedAt };
  if (!d.approved) {
    const receipt: Receipt = p.outcome === 'blocked-never'
      ? { ...base, itemIds: p.item ? [p.item.recordId] : [], status: 'blocked', decidedBy: 'rule', chars: 0 }
      : { ...base, itemIds: p.item ? [p.item.recordId] : [], status: 'declined', decidedBy: d.decidedBy, chars: 0 };
    return { payload: null, receipt };
  }
  const i = LADDER_STEPS.indexOf(d.step!);
  const parts = [p.options[i], ...d.itemIds.slice(1).map((id) => extras!.relatedOptions![id][i])];
  const text = compose(parts);
  const payload: RelayPayload = { step: d.step!, text, chars: text.length, itemCount: d.itemIds.length };
  const receipt: Receipt = { ...base, step: d.step, itemIds: d.itemIds, status: 'pending-collection', decidedBy: d.decidedBy, chars: text.length };
  return { payload, receipt };
}

interface Harness {
  engine: HomeBaseEngine;
  deps: EngineDeps;
  state: Partial<HomeBaseState>;
  push(list: RelayRequestView[]): void;
  lock: () => LockHandlers;
  bridge: ExtensionBridge & { handlers?: BridgeHandlers; resolved: [string, string][]; pendingCount: number };
  finish: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  markAwaiting: ReturnType<typeof vi.fn>;
  toast: ReturnType<typeof vi.fn>;
  now: { t: number };
  settings: { s: Settings };
  blocked: { list: BlockedEntry[] };
  interaction: { fire?: () => void };
  visible: { fire?: () => void };
}

function harness(over: Partial<EngineDeps> = {}): Harness {
  const state: Partial<HomeBaseState> = {};
  let next: ((list: RelayRequestView[]) => void) | undefined;
  let lockHandlers: LockHandlers | undefined;
  const now = { t: T0 + 10_000 };
  const settings = { s: SETTINGS };
  const blocked = { list: [] as BlockedEntry[] };
  const interaction: { fire?: () => void } = {};
  const visible: { fire?: () => void } = {};
  const bridge: Harness['bridge'] = {
    resolved: [],
    pendingCount: 0,
    start: vi.fn(),
    stop: vi.fn(),
    sendPending: vi.fn(() => {
      bridge.pendingCount += 1;
      bridge.handlers?.getPending();
    }),
    sendResolved: vi.fn((id: string, outcome: string) => void bridge.resolved.push([id, outcome])),
  };
  const finish = vi.fn(async (_u: string, _id: string, _d: string, _f: FinishInput): Promise<'ok' | 'gone'> => 'ok');
  const claim = vi.fn(async (): Promise<'claimed' | 'taken' | 'gone'> => 'claimed');
  const markAwaiting = vi.fn(async (): Promise<'ok' | 'gone'> => 'ok');
  const prepare = vi.fn(async (input: PrepareInput): Promise<Proposal> => {
    input.onProgress?.({ type: 'step-start', id: `${input.requestId}:1`, kind: 'retrieve', label: 'Searching…', where: 'code' });
    input.onProgress?.({ type: 'step-end', id: `${input.requestId}:1`, step: { kind: 'retrieve', label: 'Searched', where: 'code', ms: 2, at: now.t } });
    return proposal({ requestId: input.requestId, maxStep: input.maxStep });
  });
  const toast = vi.fn(() => 'toast');
  const records: Record<string, IndexRecord> = { 'gmail:m1': record('gmail:m1'), 'gmail:m2': record('gmail:m2') };
  const deps: EngineDeps = {
    uid: 'u1',
    deviceId: 'dev1',
    db: { name: 'sieve' } as SieveDb,
    getSettings: () => settings.s,
    getBlocked: () => blocked.list,
    resolveItemRefs: async (refs) => Object.fromEntries(refs.map((r) => [r, r])),
    getRecord: async (id) => records[id],
    putConsent: vi.fn(async () => undefined),
    requests: {
      listenRequests: vi.fn((_uid, n) => {
        next = n;
        return () => undefined;
      }),
      claimRequest: claim,
      markAwaiting,
      finishRequest: finish,
      listOpenRequests: vi.fn(async () => ({ ok: [], bad: [] })),
    },
    presence: { startPresence: vi.fn((_u, _d, onState) => {
      onState('online');
      return { stop: vi.fn(async () => undefined) };
    }) },
    lock: {
      acquireHomeBaseLock: vi.fn((_uid: string, h: LockHandlers) => {
        lockHandlers = h;
        return { cancel: vi.fn(), steal: vi.fn() };
      }),
      locksSupported: () => true,
    },
    devices: { setHomeBase: vi.fn(async () => undefined), clearHomeBase: vi.fn(async () => undefined) },
    makeBridge: (handlers) => {
      bridge.handlers = handlers;
      return bridge;
    },
    pipeline: {
      prepareProposal: prepare,
      finalizeDecision: vi.fn(fakeFinalize),
      buildRelatedOptions: vi.fn(async () => [
        option('answer', '', { available: false }),
        option('excerpt', 'Also shared: lease'),
        option('full', 'Also shared: lease (full)'),
      ]),
      composeOutgoingText: compose,
    },
    beginForeground: vi.fn(() => () => undefined),
    now: () => now.t,
    set: (patch) => Object.assign(state, patch),
    toast,
    announce: vi.fn(),
    navigate: vi.fn(),
    currentPath: () => '/',
    hasBeenActive: () => true,
    isHidden: () => false,
    online: () => true,
    onFirstInteraction: (fn) => {
      interaction.fire = fn;
      return () => undefined;
    },
    whenVisible: (fn) => {
      visible.fire = fn;
      return () => undefined;
    },
    whenOnline: (fn) => {
      queueMicrotask(fn);
      return () => undefined;
    },
    scheduleFrame: (fn) => fn(),
    ...over,
  };
  const engine = createHomeBaseEngine(deps);
  return {
    engine,
    deps,
    state,
    push: (list) => next?.(list),
    lock: () => lockHandlers as LockHandlers,
    bridge,
    finish,
    prepare,
    claim,
    markAwaiting,
    toast,
    now,
    settings,
    blocked,
    interaction,
    visible,
  };
}

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

async function activeHarness(over: Partial<EngineDeps> = {}): Promise<Harness> {
  const h = harness(over);
  h.engine.start();
  h.engine.onUserDoc({ homeBaseDeviceId: 'dev1' });
  h.lock().onAcquired();
  await flush();
  return h;
}

async function awaitingHarness(over: Partial<EngineDeps> = {}): Promise<Harness> {
  const h = await activeHarness(over);
  h.push([request()]);
  await flush();
  h.push([request({ status: 'awaiting-person', claimedBy: 'dev1' })]);
  await flush();
  return h;
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('home base engine: roles', () => {
  it('computes the role from the user doc', () => {
    const h = harness();
    h.engine.start();
    expect(h.state.role).toBe('starting');
    h.engine.onUserDoc(null);
    expect(h.state.role).toBe('not-home-base');
    h.engine.onUserDoc({ homeBaseDeviceId: 'other' });
    expect(h.state.role).toBe('other-device');
    h.engine.onUserDoc({ homeBaseDeviceId: 'dev1' });
    expect(h.state.role).toBe('starting');
    h.lock().onWaiting();
    expect(h.state.role).toBe('standby');
    h.lock().onAcquired();
    expect(h.state.role).toBe('active');
    expect(h.state.presence).toBe('online');
    expect(h.bridge.start).toHaveBeenCalled();
  });

  it('is error without Web Locks', () => {
    const h = harness({ lock: { acquireHomeBaseLock: vi.fn(), locksSupported: () => false } });
    h.engine.start();
    h.engine.onUserDoc({ homeBaseDeviceId: 'dev1' });
    expect(h.state.role).toBe('error');
    expect(h.state.errorReason).toBe(HOME_BASE.errorNoLocks);
  });

  it('only the active role claims; the listener still feeds recent', async () => {
    const h = harness();
    h.engine.start();
    h.engine.onUserDoc({ homeBaseDeviceId: 'other' });
    h.push([request()]);
    await flush();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.state.recent).toHaveLength(1);
  });
});

describe('home base engine: requests', () => {
  it('queued: claim, prepare, markAwaiting, then awaiting-person with the live trace', async () => {
    const h = await activeHarness();
    h.push([request()]);
    await flush();
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.prepare).toHaveBeenCalledTimes(1);
    const input = h.prepare.mock.calls[0][0] as PrepareInput;
    expect(input).toMatchObject({ requestId: 'req1', dataClass: 'own', requestedStep: 'answer', maxStep: 'full', blockedRecordIds: [] });
    expect(h.markAwaiting).toHaveBeenCalledWith('u1', 'req1', 'dev1');
    const e = h.state.entries!.req1;
    expect(e.phase).toBe('awaiting-person');
    expect(e.liveSteps.map((s) => s.status)).toEqual(['done']);
    expect(h.state.awaitingCount).toBe(1);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'info', title: 'New request from Gemini CLI', body: request().question }));
    expect(h.bridge.pendingCount).toBeGreaterThan(0);
  });

  it("'taken' drops the entry", async () => {
    const h = await activeHarness();
    h.claim.mockResolvedValueOnce('taken');
    h.push([request()]);
    await flush();
    expect(h.state.entries).toEqual({});
    expect(h.prepare).not.toHaveBeenCalled();
  });

  it('exactly one claim for one queued doc across snapshots (AT-12)', async () => {
    const h = await activeHarness();
    h.push([request()]);
    h.push([request()]);
    await flush();
    expect(h.claim).toHaveBeenCalledTimes(1);
  });

  it('blocked-never calls finishRequest with blocked and a rule receipt', async () => {
    const h = await activeHarness();
    h.prepare.mockImplementationOnce(async (i: PrepareInput) => proposal({ requestId: i.requestId, outcome: 'blocked-never', rule: 'never' }));
    h.push([request()]);
    await flush();
    expect(h.finish).toHaveBeenCalledTimes(1);
    const f = h.finish.mock.calls[0][3] as FinishInput;
    expect(f.status).toBe('blocked');
    expect('message' in f && f.message).toBe(MSG.blocked);
    expect('receipt' in f && f.receipt).toMatchObject({ id: 'req1', status: 'blocked', decidedBy: 'rule', chars: 0 });
    expect(h.state.entries!.req1.result).toEqual({ kind: 'auto', status: 'blocked' });
  });

  it('no-match finishes with no receipt and the same sentence as blocked (00 D6)', async () => {
    const h = await activeHarness();
    h.prepare.mockImplementationOnce(async (i: PrepareInput) => proposal({ requestId: i.requestId, outcome: 'no-match', item: undefined }));
    h.push([request()]);
    await flush();
    const f = h.finish.mock.calls[0][3] as FinishInput;
    expect(f).toEqual({ status: 'no-match', message: MSG.noMatch });
    expect(MSG.noMatch).toBe(MSG.blocked);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('model-unavailable and a thrown error finish with error and a toast', async () => {
    const h = await activeHarness();
    h.prepare.mockImplementationOnce(async (i: PrepareInput) => proposal({ requestId: i.requestId, outcome: 'model-unavailable' }));
    h.push([request()]);
    await flush();
    expect(h.finish.mock.calls[0][3]).toEqual({ status: 'error', message: MSG.modelUnavailable });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
    h.prepare.mockRejectedValueOnce(new Error('boom'));
    h.push([request({ id: 'req2', createdAt: T0 + 1 })]);
    await flush();
    expect(h.finish.mock.calls[1][3]).toEqual({ status: 'error', message: MSG.error });
  });

  it('expiry aborts the preparation: the entry is removed and nothing is written', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = await activeHarness();
    h.prepare.mockImplementationOnce(
      (i: PrepareInput) =>
        new Promise<Proposal>((resolve) => {
          i.signal?.addEventListener('abort', () => resolve(proposal({ requestId: i.requestId, outcome: 'error' })));
        }),
    );
    h.push([request({ expireAt: T0 + 20_000 })]);
    await flush();
    expect(h.state.entries!.req1.phase).toBe('preparing');
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(h.state.entries).toEqual({});
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('a terminal snapshot ends the entry and sends sieve/resolved expired', async () => {
    const h = await awaitingHarness();
    h.push([request({ status: 'expired' })]);
    await flush();
    expect(h.state.entries!.req1.result).toEqual({ kind: 'ended', status: 'expired' });
    expect(h.bridge.resolved).toContainEqual(['req1', 'expired']);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: HOME_BASE.expiredToast('Gemini CLI') }));
    h.push([request({ id: 'req2', status: 'queued' })]);
    await flush();
    h.push([request({ id: 'req2', status: 'awaiting-person', claimedBy: 'dev1' })]);
    h.push([request({ id: 'req2', status: 'revoked' })]);
    await flush();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: HOME_BASE.revokedToast('Gemini CLI') }));
  });

  it('a reloaded tab prepares its own claimed doc again', async () => {
    const h = await activeHarness();
    h.push([request({ status: 'claimed', claimedBy: 'dev1' })]);
    await flush();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.state.entries!.req1.phase).toBe('awaiting-person');
  });

  it('a malformed queued request is claimed and ended with error (70 R-RLY-11)', async () => {
    const h = await activeHarness();
    const listen = h.deps.requests.listenRequests as ReturnType<typeof vi.fn>;
    const onInvalid = listen.mock.calls[0][3] as (bad: { id: string; status: unknown }[]) => void;
    onInvalid([{ id: 'bad1', status: 'queued' }, { id: 'bad2', status: 'answered' }]);
    await flush();
    expect(h.claim).toHaveBeenCalledWith('u1', 'bad1', 'dev1');
    expect(h.finish).toHaveBeenCalledWith('u1', 'bad1', 'dev1', { status: 'error', message: MSG.badRequest });
    expect(h.claim).toHaveBeenCalledTimes(1);
  });

  it('the activation gate waits for the first interaction', async () => {
    let active = false;
    const h = await activeHarness({ hasBeenActive: () => active });
    h.push([request()]);
    await flush();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.state.waitingForClick).toBe(true);
    expect(h.state.entries!.req1.liveSteps[0]).toMatchObject({ label: HOME_BASE.waitingForClick, where: 'device', status: 'running' });
    active = true;
    h.interaction.fire?.();
    await flush();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.state.waitingForClick).toBe(false);
    expect(h.state.entries!.req1.phase).toBe('awaiting-person');
  });

  it('a timeout in a hidden tab waits for the tab, then retries once (70 R-PLAT-01)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hidden = true;
    const h = await activeHarness({ isHidden: () => hidden });
    h.prepare.mockImplementationOnce(
      (i: PrepareInput) =>
        new Promise<Proposal>((resolve) => {
          i.signal?.addEventListener('abort', () => resolve(proposal({ requestId: i.requestId, outcome: 'error' })));
        }),
    );
    h.push([request()]);
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(h.finish).not.toHaveBeenCalled();
    expect(h.state.entries!.req1.liveSteps[0].label).toBe(HOME_BASE.waitingHidden);
    hidden = false;
    h.visible.fire?.();
    await flush();
    expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(h.state.entries!.req1.phase).toBe('awaiting-person');
  });

  it('an offline claim is retried when the browser is back online', async () => {
    const h = await activeHarness();
    h.claim.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    h.push([request()]);
    await flush();
    expect(h.claim).toHaveBeenCalledTimes(2);
    expect(h.state.entries!.req1.phase).toBe('awaiting-person');
  });

  it('lock lost stops claiming and presence, keeps waiting entries decidable', async () => {
    const h = await awaitingHarness();
    h.lock().onLost();
    expect(h.state.role).toBe('standby');
    expect(h.toast).toHaveBeenCalledWith({ tone: 'info', title: HOME_BASE.anotherTab });
    h.push([request({ status: 'awaiting-person', claimedBy: 'dev1' }), request({ id: 'req2', createdAt: T0 + 5 })]);
    await flush();
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.state.entries!.req1.phase).toBe('awaiting-person');
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    expect(r).toEqual({ ok: true });
  });
});

describe('home base engine: decisions', () => {
  it('approve calls finishRequest(answered) once with the response and the receipt (AT-13)', async () => {
    const h = await awaitingHarness();
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    expect(r).toEqual({ ok: true });
    expect(h.finish).toHaveBeenCalledTimes(1);
    const f = h.finish.mock.calls[0][3] as Extract<FinishInput, { status: 'answered' }>;
    expect(f.status).toBe('answered');
    expect(f.response.text).toBe(proposal().options[0].text);
    expect(f.receipt).toMatchObject({ id: 'req1', requestId: 'req1', status: 'pending-collection', itemIds: ['gmail:m1'] });
    expect(h.state.entries!.req1.result).toEqual({ kind: 'sent', step: 'answer', itemCount: 1, by: 'app' });
    expect(h.bridge.resolved).toContainEqual(['req1', 'approved']);
    expect(h.deps.announce).toHaveBeenCalledWith('Sent the answer to Gemini CLI.', 'polite');
  });

  it('approves with related items ticked in the app', async () => {
    const h = await awaitingHarness();
    await h.engine.toggleRelated('req1', 'gmail:m2');
    expect(h.state.entries!.req1.relatedSelected).toEqual(['gmail:m2']);
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'excerpt', decidedBy: 'app' });
    expect(r).toEqual({ ok: true });
    const f = h.finish.mock.calls[0][3] as Extract<FinishInput, { status: 'answered' }>;
    expect(f.response.text).toBe(`${proposal().options[1].text}\n\nAlso shared: lease`);
    expect(f.response.itemCount).toBe(2);
  });

  it('decline writes declined with its receipt', async () => {
    const h = await awaitingHarness();
    const r = await h.engine.decide({ requestId: 'req1', approved: false, decidedBy: 'app' });
    expect(r).toEqual({ ok: true });
    const f = h.finish.mock.calls[0][3] as Extract<FinishInput, { status: 'declined' }>;
    expect(f).toMatchObject({ status: 'declined', message: MSG.declined, receipt: { id: 'req1', status: 'declined' } });
    expect(h.bridge.resolved).toContainEqual(['req1', 'declined']);
  });

  it('a payload mismatch sends nothing', async () => {
    const h = await awaitingHarness();
    (h.deps.pipeline.finalizeDecision as ReturnType<typeof vi.fn>).mockImplementationOnce(async (p: Proposal, d: Decision) => {
      const out = await fakeFinalize(p, d);
      return { ...out, payload: { ...out.payload!, text: out.payload!.text + ' and more' } };
    });
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    expect(r).toMatchObject({ ok: false, reason: 'error', message: DECIDE_ERRORS.mismatch });
    expect(h.finish).not.toHaveBeenCalled();
    expect(h.state.entries!.req1.phase).toBe('awaiting-person');
  });

  it('offline returns offline and the entry stays decidable', async () => {
    const h = await awaitingHarness();
    h.finish.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }));
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    expect(r).toEqual({ ok: false, reason: 'offline', message: DECIDE_ERRORS.offline });
    expect(h.state.entries!.req1.phase).toBe('awaiting-person');
    expect(await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' })).toEqual({ ok: true });
    expect(h.finish).toHaveBeenCalledTimes(2);
  });

  it("'gone' on write ends the entry as expired", async () => {
    const h = await awaitingHarness();
    h.finish.mockResolvedValueOnce('gone');
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    expect(r).toMatchObject({ ok: false, reason: 'expired' });
    expect(h.state.entries!.req1.result).toEqual({ kind: 'ended', status: 'expired' });
  });

  it('a double approval (app and extension in the same tick) writes once (70 R-RLY-03)', async () => {
    const h = await awaitingHarness();
    const a = h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    h.bridge.handlers!.onDecision({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'extension' });
    expect(await a).toEqual({ ok: true });
    await flush();
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.bridge.resolved).toEqual([['req1', 'approved']]);
  });

  it('an extension decision that is not pending only resends the list', async () => {
    const h = await awaitingHarness();
    const before = h.bridge.pendingCount;
    const r = await h.engine.decide({ requestId: 'nope', approved: true, step: 'answer', decidedBy: 'extension' });
    expect(r.ok).toBe(false);
    expect(h.bridge.pendingCount).toBe(before + 1);
    expect(h.bridge.resolved).toEqual([]);
  });

  it('an extension decision above maxStep sends resolved error and writes nothing (AT-15)', async () => {
    const h = await activeHarness();
    h.prepare.mockImplementationOnce(async (i: PrepareInput) => proposal({ requestId: i.requestId, maxStep: 'answer' }));
    h.push([request({ maxStep: 'answer' })]);
    await flush();
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'full', decidedBy: 'extension' });
    expect(r).toMatchObject({ ok: false, reason: 'invalid-step' });
    expect(h.bridge.resolved).toEqual([['req1', 'error']]);
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('an extension approval shares the main item only and toasts', async () => {
    const h = await awaitingHarness();
    await h.engine.toggleRelated('req1', 'gmail:m2');
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'excerpt', decidedBy: 'extension' });
    expect(r).toEqual({ ok: true });
    const f = h.finish.mock.calls[0][3] as Extract<FinishInput, { status: 'answered' }>;
    expect(f.response.itemCount).toBe(1);
    expect(f.response.text).toBe(proposal().options[1].text);
    expect(h.toast).toHaveBeenCalledWith({ tone: 'success', title: HOME_BASE.approvedInExtension('an excerpt', 'Gemini CLI') });
  });

  it('a rule changed to never after the proposal is refused at send time (70 R-RLY-10)', async () => {
    const h = await awaitingHarness();
    h.settings.s = { ...SETTINGS, categoryRules: { ...SETTINGS.categoryRules, Home: 'never' } };
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    expect(r).toMatchObject({ ok: false, message: SEND_CHECK.ruleNever('Home') });
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('a rule changed to never re-prepares the open card', async () => {
    const h = await awaitingHarness();
    h.engine.onSettings(SETTINGS);
    h.settings.s = { ...SETTINGS, categoryRules: { ...SETTINGS.categoryRules, Home: 'never' } };
    h.prepare.mockImplementationOnce(async (i: PrepareInput) => proposal({ requestId: i.requestId, outcome: 'blocked-never' }));
    h.engine.onSettings(h.settings.s);
    await flush();
    expect(h.prepare).toHaveBeenCalledTimes(2);
  });

  it('a block that arrives later is refused at send time', async () => {
    const h = await awaitingHarness();
    h.blocked.list = [{ id: 'b1', recordId: 'gmail:m1', grantId: 'g1', recordRef: 'gmail:m1' }];
    const r = await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' });
    expect(r).toMatchObject({ ok: false, message: SEND_CHECK.blocked('Gemini CLI') });
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('a narrowed grant: a lower maxStep marks higher options unavailable; a removed category re-prepares (70 R-RLY-09)', async () => {
    const h = await awaitingHarness();
    h.push([request({ status: 'awaiting-person', claimedBy: 'dev1', maxStep: 'answer' })]);
    await flush();
    const opts = h.state.entries!.req1.proposal!.options;
    expect(opts.map((o) => o.available)).toEqual([true, false, false]);
    expect(opts[1].unavailableReason).toBe(HOME_BASE.mayOnlyReceive('Gemini CLI', 'answer'));
    const forced = await h.engine.decide({ requestId: 'req1', approved: true, step: 'full', decidedBy: 'app' });
    expect(forced).toMatchObject({ ok: false, reason: 'invalid-step' });
    h.push([request({ status: 'awaiting-person', claimedBy: 'dev1', maxStep: 'answer', allowedCategories: CATEGORIES.filter((c) => c !== 'Home') })]);
    await flush();
    expect(h.prepare).toHaveBeenCalledTimes(2);
  });

  it('resync after a wake ends entries past their deadline', async () => {
    const h = await awaitingHarness();
    h.now.t = T0 + 121 * 60_000;
    await h.engine.resync();
    expect(h.state.entries!.req1.result).toEqual({ kind: 'ended', status: 'expired' });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: HOME_BASE.expiredToast('Gemini CLI') }));
  });

  it('stop aborts everything and stops presence and the bridge', async () => {
    const h = await awaitingHarness();
    await h.engine.stop();
    expect(h.bridge.stop).toHaveBeenCalled();
    const presence = (h.deps.presence.startPresence as ReturnType<typeof vi.fn>).mock.results[0].value as { stop: ReturnType<typeof vi.fn> };
    expect(presence.stop).toHaveBeenCalled();
  });

  it('stopBeingHomeBase clears the choice; makeThisHomeBase writes it', async () => {
    const h = await activeHarness();
    await h.engine.stopBeingHomeBase();
    expect(h.deps.devices.clearHomeBase).toHaveBeenCalledWith('u1', 'dev1');
    expect(h.state.role).toBe('not-home-base');
    await h.engine.makeThisHomeBase('  Mac mini  ');
    expect(h.deps.devices.setHomeBase).toHaveBeenCalledWith('u1', 'dev1', 'Mac mini');
  });

  it('allowCloudFor records the consent and prepares again', async () => {
    const h = await activeHarness();
    h.prepare.mockImplementationOnce(async (i: PrepareInput) => proposal({ requestId: i.requestId, outcome: 'needs-cloud-consent' }));
    h.push([request()]);
    await flush();
    expect(h.state.entries!.req1.proposal!.outcome).toBe('needs-cloud-consent');
    await h.engine.allowCloudFor('req1', 'gmail:m1');
    await flush();
    expect(h.deps.putConsent).toHaveBeenCalledWith('gmail:m1', h.now.t);
    expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(h.state.entries!.req1.proposal!.outcome).toBe('ready');
  });
});

describe('home base engine: stop, extension shortcut and the Playground (00 D1)', () => {
  it('stopPreparing aborts the preparation, leaves the request claimed and does not prepare it again', async () => {
    const h = await activeHarness();
    h.prepare.mockImplementationOnce(
      (i: PrepareInput) => new Promise<Proposal>((resolve) => i.signal?.addEventListener('abort', () => resolve(proposal({ requestId: i.requestId, outcome: 'error' })))),
    );
    h.push([request()]);
    await flush();
    expect(h.state.entries!.req1.phase).toBe('preparing');
    const signal = (h.prepare.mock.calls[0][0] as PrepareInput).signal!;
    await h.engine.stopPreparing('req1');
    await flush();
    expect(signal.aborted).toBe(true);
    expect(h.state.entries).toEqual({});
    expect(h.finish).not.toHaveBeenCalled();
    h.push([request({ status: 'claimed', claimedBy: 'dev1' })]);
    await flush();
    expect(h.prepare).toHaveBeenCalledTimes(1);
  });

  it('keeps the extension shortcut from the hello-ack', async () => {
    const h = await activeHarness();
    h.bridge.handlers!.onHello!({ extensionVersion: '1.0.0', extensionShortcut: 'Alt+Shift+S' });
    expect(h.state.extensionShortcut).toBe('Alt+Shift+S');
  });

  it('the real home base never claims a Playground request', async () => {
    const h = await activeHarness();
    h.push([request({ allowedSources: ['playground'] })]);
    await flush();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.state.recent).toEqual([]);
  });

  it('Playground mode: active at once, sample data, only Playground requests, receipts kept local', async () => {
    const saveLocalReceipt = vi.fn(async () => undefined);
    const h = harness({
      kind: 'playground',
      saveLocalReceipt,
      makeBridge: () => null,
      getRecord: async (id) => (id === 'playground:e1' ? record('playground:e1') : undefined),
    });
    h.prepare.mockImplementation(async (i: PrepareInput) =>
      proposal({ requestId: i.requestId, item: { ...proposal().item!, recordId: 'playground:e1' } }),
    );
    h.engine.start();
    expect(h.state.role).toBe('active');
    expect(h.deps.lock.acquireHomeBaseLock).not.toHaveBeenCalled();
    expect(h.deps.presence.startPresence).not.toHaveBeenCalled();
    h.push([request({ allowedSources: ['playground'] }), request({ id: 'real1', createdAt: T0 + 5 })]);
    await flush();
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.claim).toHaveBeenCalledWith('u1', 'req1', 'dev1');
    expect((h.prepare.mock.calls[0][0] as PrepareInput).dataClass).toBe('sample');
    h.push([request({ allowedSources: ['playground'], status: 'awaiting-person', claimedBy: 'dev1' })]);
    await flush();
    expect(await h.engine.decide({ requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' })).toEqual({ ok: true });
    const f = h.finish.mock.calls[0][3] as FinishInput;
    expect(f.status).toBe('answered');
    expect('receipt' in f).toBe(false);
    expect(saveLocalReceipt).toHaveBeenCalledWith(expect.objectContaining({ id: 'req1', requestId: 'req1' }));
  });
});

