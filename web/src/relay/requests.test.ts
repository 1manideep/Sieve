// relay/requests.ts with an in-memory Firestore double: parsing, and the transitions the home base may write
// (30 section 9.1, 01 section 11.6; 60 section 3.5). The same transitions run against the emulator in
// requests.emulator.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Receipt } from '@sieve/shared';

const docs = new Map<string, Record<string, unknown>>();
let failNext: Error | null = null;

vi.mock('@/app/services/firestore', () => ({
  firestore: () => ({}),
  millis: (v: unknown) => (v && typeof v === 'object' && 'toMillis' in v ? (v as { toMillis(): number }).toMillis() : typeof v === 'number' ? v : undefined),
}));
vi.mock('@/app/services/receipts', () => ({
  toReceiptDoc: async (_uid: string, r: Receipt) => ({ id: r.id, requestId: r.requestId, itemRefs: r.itemIds.map(() => 'f'.repeat(64)), status: r.status, chars: r.chars }),
}));
vi.mock('firebase/firestore', () => {
  const ref = (...parts: string[]) => ({ path: parts.join('/') });
  return {
    doc: (_db: unknown, ...parts: string[]) => ref(...parts),
    collection: (_db: unknown, ...parts: string[]) => ref(...parts),
    query: (c: unknown) => c,
    orderBy: () => undefined,
    limit: () => undefined,
    where: () => undefined,
    getDocs: async () => ({ docs: [] }),
    onSnapshot: () => () => undefined,
    serverTimestamp: () => 'SERVER_TIME',
    deleteField: () => 'DELETE',
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      const writes: [string, Record<string, unknown>, boolean][] = [];
      const tx = {
        get: async (r: { path: string }) => ({ exists: () => docs.has(r.path), data: () => ({ ...docs.get(r.path) }) }),
        update: (r: { path: string }, patch: Record<string, unknown>) => writes.push([r.path, patch, true]),
        set: (r: { path: string }, data: Record<string, unknown>) => writes.push([r.path, data, false]),
      };
      const out = await fn(tx);
      for (const [path, data, merge] of writes) {
        const next = merge ? { ...docs.get(path), ...data } : { ...data };
        for (const [k, v] of Object.entries(next)) if (v === 'DELETE') delete next[k];
        docs.set(path, next);
      }
      return out;
    },
  };
});

const { claimRequest, markAwaiting, finishRequest, parseRequestDoc, parseStoredHints, decisionDeadline, revokeAnswered } = await import('./requests');

const P = 'users/u1/requests/r1';
const ts = (ms: number) => ({ toMillis: () => ms });

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' },
    tool: 'sieve_answer',
    requestedStep: 'answer',
    maxStep: 'excerpt',
    allowedCategories: ['Home'],
    allowedSources: ['gmail'],
    question: 'What did my landlord say?',
    status: 'queued',
    createdAt: ts(1000),
    expireAt: ts(1000 + 86_400_000),
    ...over,
  };
}

const receipt = (status: Receipt['status']): Receipt => ({
  id: 'x', requestId: 'r1', requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' }, question: 'q', itemIds: ['folder:taxes/W-2.pdf'], status, chars: 5, createdAt: 1,
});

beforeEach(() => {
  docs.clear();
  failNext = null;
});

describe('parseRequestDoc (70 R-RLY-11)', () => {
  it('reads a valid doc with epoch ms', () => {
    const v = parseRequestDoc('r1', base({ hints: { after: '2026-01-02', terms: ['A1', 7], source: 'mail', junk: 1 } }));
    expect(v).toMatchObject({ id: 'r1', status: 'queued', createdAt: 1000, expireAt: 1000 + 86_400_000, hints: { after: '2026-01-02', terms: ['A1'], source: 'mail' } });
  });

  it.each([
    ['unknown status', { status: 'weird' }],
    ['bad maxStep', { maxStep: 'everything' }],
    ['question not a string', { question: 42 }],
    ['in-app requester', { requester: { kind: 'in-app', aiName: 'x' } }],
    ['unknown category', { allowedCategories: ['Secrets'] }],
    ['missing expireAt', { expireAt: null }],
  ])('rejects %s', (_name, over) => {
    expect(parseRequestDoc('r1', base(over))).toBeNull();
  });

  it('drops invalid hints entirely', () => {
    expect(parseStoredHints({ after: 'yesterday', source: 'web' })).toBeUndefined();
    expect(parseStoredHints('x')).toBeUndefined();
  });

  it('the deadline is the earlier of expireAt and createdAt + 120 min', () => {
    expect(decisionDeadline({ createdAt: 0, expireAt: 86_400_000 })).toBe(120 * 60_000);
    expect(decisionDeadline({ createdAt: 0, expireAt: 1000 })).toBe(1000);
  });
});

describe('transitions the home base may write', () => {
  it('queued to claimed, once', async () => {
    docs.set(P, base());
    expect(await claimRequest('u1', 'r1', 'dev1')).toBe('claimed');
    expect(docs.get(P)).toMatchObject({ status: 'claimed', claimedBy: 'dev1', claimedAt: 'SERVER_TIME' });
    expect(await claimRequest('u1', 'r1', 'dev2')).toBe('taken');
    expect(await claimRequest('u1', 'nope', 'dev1')).toBe('gone');
  });

  it('claimed to awaiting-person for our claim only; already awaiting is a no-op', async () => {
    docs.set(P, base({ status: 'claimed', claimedBy: 'dev1' }));
    expect(await markAwaiting('u1', 'r1', 'dev2')).toBe('gone');
    expect(await markAwaiting('u1', 'r1', 'dev1')).toBe('ok');
    expect(docs.get(P)!.status).toBe('awaiting-person');
    expect(await markAwaiting('u1', 'r1', 'dev1')).toBe('ok');
  });

  it('awaiting-person to answered writes the response and the receipt (id = request id) together', async () => {
    docs.set(P, base({ status: 'awaiting-person', claimedBy: 'dev1' }));
    const response = { step: 'answer' as const, text: 'Your deposit was $1,200.', chars: 24, itemCount: 1 };
    expect(await finishRequest('u1', 'r1', 'dev1', { status: 'answered', response, receipt: receipt('pending-collection') })).toBe('ok');
    expect(docs.get(P)).toMatchObject({ status: 'answered', answeredAt: 'SERVER_TIME', response });
    const rc = docs.get('users/u1/receipts/r1');
    expect(rc).toMatchObject({ id: 'r1', status: 'pending-collection' });
    expect(JSON.stringify(rc)).not.toContain('taxes');
    // a second write cannot happen
    expect(await finishRequest('u1', 'r1', 'dev1', { status: 'answered', response, receipt: receipt('pending-collection') })).toBe('gone');
  });

  it('answered and declined only from awaiting-person; no-match and blocked only from claimed; error from either', async () => {
    docs.set(P, base({ status: 'claimed', claimedBy: 'dev1' }));
    expect(await finishRequest('u1', 'r1', 'dev1', { status: 'declined', message: 'm', receipt: receipt('declined') })).toBe('gone');
    expect(await finishRequest('u1', 'r1', 'dev1', { status: 'no-match', message: 'Nothing to share for that.' })).toBe('ok');
    expect(docs.get(P)).toMatchObject({ status: 'no-match', message: 'Nothing to share for that.' });
    expect(docs.has('users/u1/receipts/r1')).toBe(false);

    docs.set(P, base({ status: 'awaiting-person', claimedBy: 'dev1' }));
    expect(await finishRequest('u1', 'r1', 'dev1', { status: 'blocked', message: 'm', receipt: receipt('blocked') })).toBe('gone');
    expect(await finishRequest('u1', 'r1', 'dev1', { status: 'error', message: 'e'.repeat(400) })).toBe('ok');
    expect((docs.get(P)!.message as string).length).toBe(300);
  });

  it("refuses another device's claim", async () => {
    docs.set(P, base({ status: 'awaiting-person', claimedBy: 'dev2' }));
    expect(await finishRequest('u1', 'r1', 'dev1', { status: 'declined', message: 'm', receipt: receipt('declined') })).toBe('gone');
  });

  it('answered to revoked deletes the response (01 section 11.6)', async () => {
    docs.set(P, base({ status: 'answered', claimedBy: 'dev1', response: { step: 'answer', text: 't', chars: 1, itemCount: 1 } }));
    expect(await revokeAnswered('u1', 'r1')).toBe('ok');
    expect(docs.get(P)!.status).toBe('revoked');
    expect(docs.get(P)).not.toHaveProperty('response');
  });

  it('an offline transaction rejects (the engine retries)', async () => {
    docs.set(P, base());
    failNext = Object.assign(new Error('offline'), { code: 'unavailable' });
    await expect(claimRequest('u1', 'r1', 'dev1')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
