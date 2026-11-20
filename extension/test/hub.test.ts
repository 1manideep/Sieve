import { beforeEach, describe, expect, it } from 'vitest';
import { GRACE_MS, Hub, RESOLVED_KEEP_MS, RESOLVED_MAX } from '../src/sw/hub';
import { DEPOSIT, LEASE, STATEMENT, withId } from './fixtures';

let clock = 1_000_000;
const now = () => clock;

function hubWith(...conns: { id: string; homeBase: boolean; windowId?: number }[]): Hub {
  const hub = new Hub(now);
  for (const c of conns) {
    hub.addConn({ id: c.id, origin: 'http://localhost:5173', tabId: 10, windowId: c.windowId ?? 1 });
    hub.hello(c.id, c.homeBase, '0.1.0');
  }
  return hub;
}

beforeEach(() => {
  clock = 1_000_000;
});

describe('union and ownership', () => {
  it('puts the home base first, dedupes by id and assigns the owner', () => {
    const hub = hubWith({ id: 'pg', homeBase: false }, { id: 'hb', homeBase: true });
    hub.setPending('pg', [withId(LEASE, 'shared'), LEASE]);
    clock += 10;
    hub.setPending('hb', [DEPOSIT, withId(STATEMENT, 'shared')]);
    expect(hub.union().map((p) => p.requestId)).toEqual([DEPOSIT.requestId, 'shared', LEASE.requestId]);
    expect(hub.owner('shared')?.id).toBe('hb');
    expect(hub.owner(LEASE.requestId)?.id).toBe('pg');
    expect(hub.union().find((p) => p.requestId === 'shared')?.question).toBe(STATEMENT.question);
  });

  it('orders non-home-base connections by the newest pending first', () => {
    const hub = hubWith({ id: 'a', homeBase: false }, { id: 'b', homeBase: false });
    hub.setPending('a', [withId(DEPOSIT, 'one')]);
    clock += 5;
    hub.setPending('b', [withId(DEPOSIT, 'two')]);
    expect(hub.union().map((p) => p.requestId)).toEqual(['two', 'one']);
  });

  it('ignores pending from a connection that has not said hello', () => {
    const hub = new Hub(now);
    hub.addConn({ id: 'x', origin: 'http://localhost:5173' });
    expect(hub.setPending('x', [DEPOSIT])).toEqual({ added: [], removed: [] });
    expect(hub.union()).toEqual([]);
  });

  it('returns added and removed ids', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    expect(hub.setPending('hb', [DEPOSIT, LEASE])).toEqual({ added: [DEPOSIT.requestId, LEASE.requestId], removed: [] });
    expect(hub.setPending('hb', [LEASE, STATEMENT])).toEqual({ added: [STATEMENT.requestId], removed: [DEPOSIT.requestId] });
    expect(hub.setPending('hb', [LEASE, STATEMENT])).toEqual({ added: [], removed: [] });
  });

  it('homeBaseConn prefers a ready home base, else the first ready connection', () => {
    const hub = hubWith({ id: 'pg', homeBase: false });
    expect(hub.homeBaseConn()?.id).toBe('pg');
    hub.addConn({ id: 'hb', origin: 'http://localhost:5173' });
    hub.hello('hb', true, '0.1.0');
    expect(hub.homeBaseConn()?.id).toBe('hb');
  });
});

describe('actionableCount', () => {
  it('counts ready and needs-cloud-consent only, and excludes decisions in flight', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [
      DEPOSIT,
      withId(DEPOSIT, 'consent', { outcome: 'needs-cloud-consent' }),
      withId(DEPOSIT, 'nomatch', { outcome: 'no-match' }),
      withId(DEPOSIT, 'blocked', { outcome: 'blocked-never' }),
      withId(DEPOSIT, 'model', { outcome: 'model-unavailable' }),
      withId(DEPOSIT, 'err', { outcome: 'error' }),
    ]);
    expect(hub.actionableCount()).toBe(2);
    expect(hub.decide(DEPOSIT.requestId, true, 'answer').ok).toBe(true);
    expect(hub.actionableCount()).toBe(1);
  });
});

describe('decide', () => {
  it('builds the exact decision on approve, and omits step on deny', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [DEPOSIT, LEASE]);
    expect(hub.decide(DEPOSIT.requestId, true, 'excerpt')).toEqual({
      ok: true,
      connId: 'hb',
      decision: { requestId: DEPOSIT.requestId, approved: true, step: 'excerpt', itemIds: [], decidedBy: 'extension', decidedAt: clock },
    });
    const deny = hub.decide(LEASE.requestId, false, 'answer');
    expect(deny).toEqual({
      ok: true,
      connId: 'hb',
      decision: { requestId: LEASE.requestId, approved: false, itemIds: [], decidedBy: 'extension', decidedAt: clock },
    });
    expect(deny.ok && 'step' in deny.decision).toBe(false);
  });

  it('fails with each reason', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [DEPOSIT, LEASE, withId(DEPOSIT, 'nomatch', { outcome: 'no-match' })]);
    expect(hub.decide('missing', true, 'answer')).toEqual({ ok: false, reason: 'unknown-request' });
    expect(hub.decide('nomatch', true, 'answer')).toEqual({ ok: false, reason: 'not-ready' });
    expect(hub.decide(LEASE.requestId, true, 'full')).toEqual({ ok: false, reason: 'step-unavailable' });
    expect(hub.decide(LEASE.requestId, true)).toEqual({ ok: false, reason: 'step-unavailable' });
    expect(hub.decide(DEPOSIT.requestId, true, 'answer').ok).toBe(true);
    expect(hub.decide(DEPOSIT.requestId, false)).toEqual({ ok: false, reason: 'already-sent' });
  });

  it('refuses a step above maxStep even when the page marked it available', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    const capped = withId(DEPOSIT, 'capped', { maxStep: 'answer' }); // all three options say available
    hub.setPending('hb', [capped]);
    expect(hub.decide('capped', true, 'excerpt')).toEqual({ ok: false, reason: 'step-unavailable' });
    expect(hub.decide('capped', true, 'answer').ok).toBe(true);
  });

  it('allows deny for no-match and other non-ready outcomes', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [withId(DEPOSIT, 'nomatch', { outcome: 'no-match' }), withId(DEPOSIT, 'err', { outcome: 'error' })]);
    expect(hub.decide('nomatch', false).ok).toBe(true);
    expect(hub.decide('err', false).ok).toBe(true);
  });

  it('allows a second decision once the first is marked slow', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [DEPOSIT]);
    hub.decide(DEPOSIT.requestId, true, 'answer');
    hub.markSlow(DEPOSIT.requestId);
    expect(hub.view().inflight[0]?.slow).toBe(true);
    expect(hub.decide(DEPOSIT.requestId, true, 'answer').ok).toBe(true);
  });
});

describe('resolved and lost', () => {
  it('records decidedHere true with the step when this extension decided', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [DEPOSIT]);
    hub.decide(DEPOSIT.requestId, true, 'excerpt');
    clock += 50;
    hub.resolved('hb', DEPOSIT.requestId, 'approved');
    const v = hub.view();
    expect(v.inflight).toEqual([]);
    expect(v.proposals).toEqual([]);
    expect(v.resolved).toEqual([
      { requestId: DEPOSIT.requestId, outcome: 'approved', step: 'excerpt', decidedHere: true, aiName: 'Test assistant', question: DEPOSIT.question, at: clock },
    ]);
  });

  it('records decidedHere false when the app decided', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [DEPOSIT, LEASE]);
    hub.resolved('hb', DEPOSIT.requestId, 'approved');
    hub.decide(LEASE.requestId, false);
    hub.resolved('hb', LEASE.requestId, 'approved'); // the app approved first
    const [lease, deposit] = hub.view().resolved;
    expect(deposit).toMatchObject({ requestId: DEPOSIT.requestId, decidedHere: false });
    expect(deposit && 'step' in deposit).toBe(false);
    expect(lease).toMatchObject({ requestId: LEASE.requestId, outcome: 'approved', decidedHere: false });
  });

  it('turns decisions in flight into lost when the owner goes away', () => {
    const hub = hubWith({ id: 'hb', homeBase: true }, { id: 'pg', homeBase: false });
    hub.setPending('hb', [DEPOSIT]);
    hub.setPending('pg', [LEASE]);
    hub.decide(DEPOSIT.requestId, true, 'answer');
    expect(hub.removeConn('hb')).toEqual({ lost: [DEPOSIT.requestId], removed: [DEPOSIT.requestId] });
    const v = hub.view();
    expect(v.proposals.map((p) => p.requestId)).toEqual([LEASE.requestId]);
    expect(v.resolved[0]).toMatchObject({ requestId: DEPOSIT.requestId, outcome: 'lost', decidedHere: true });
    expect(v.inflight).toEqual([]);
  });

  it('dismiss removes a resolved entry', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    hub.setPending('hb', [DEPOSIT]);
    hub.resolved('hb', DEPOSIT.requestId, 'declined');
    hub.dismiss(DEPOSIT.requestId);
    expect(hub.view().resolved).toEqual([]);
  });

  it('prunes resolved entries after 10 minutes and keeps at most 20', () => {
    const hub = hubWith({ id: 'hb', homeBase: true });
    const list = Array.from({ length: 25 }, (_, i) => withId(DEPOSIT, `r-${i}`));
    hub.setPending('hb', list);
    for (const p of list) {
      clock += 1;
      hub.resolved('hb', p.requestId, 'expired');
    }
    const v = hub.view();
    expect(v.resolved).toHaveLength(RESOLVED_MAX);
    expect(v.resolved[0]?.requestId).toBe('r-24'); // newest first
    clock += RESOLVED_KEEP_MS + 100;
    expect(hub.view().resolved).toEqual([]);
  });
});

describe('connection state (50 section 7.5)', () => {
  it('is connecting during the grace period, then disconnected', () => {
    const hub = new Hub(now);
    expect(hub.view().connection).toBe('connecting');
    clock += GRACE_MS;
    expect(hub.view().connection).toBe('disconnected');
  });

  it('is not-home-base with only a Playground tab, connected with a home base', () => {
    const hub = hubWith({ id: 'pg', homeBase: false });
    expect(hub.view().connection).toBe('not-home-base');
    hub.addConn({ id: 'hb', origin: 'https://sieve.manideep.info' });
    expect(hub.view().connection).toBe('not-home-base'); // not ready yet
    hub.hello('hb', true, '0.1.0');
    expect(hub.view().connection).toBe('connected');
    hub.removeConn('hb');
    hub.removeConn('pg');
    clock += GRACE_MS;
    expect(hub.view().connection).toBe('disconnected');
  });

  it('view carries the app URL', () => {
    expect(new Hub(now).view().appUrl).toBe('http://localhost:5173');
  });
});
