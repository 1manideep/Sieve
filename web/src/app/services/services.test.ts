// Unit tests for the UI-layer services with the Firebase SDK left unused (pure helpers) or mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES, type Receipt } from '@sieve/shared';
import { CALLABLE_ERRORS } from '@/copy/strings';
import { DEFAULT_SETTINGS } from '@/state/settings';

const records = ['gmail:m1', 'folder:taxes/2025/W-2.pdf', 'upload:upload-1'];
vi.mock('@/index', () => ({
  openDb: () => ({ name: 'sieve', records: { toCollection: () => ({ primaryKeys: async () => records }) } }),
}));

const { missingSettingPaths, readSettings, toUserDocView } = await import('./userDoc');
const { isItemRef, itemRef, itemRefs, resolveItemRefs, forgetLocalSalt, resetItemRefsForTests } = await import('./itemRefs');
const { callableMessage, callableCode, CALLABLE_NAMES } = await import('./callables');
const { grantState, toGrantView, EXPIRING_MS } = await import('./grants');
const { receiptDoc, toReceiptView } = await import('./receipts');
const { blockedFor, blockedRefsFor } = await import('./blocked');
const { toDeviceView } = await import('./devices');
const { openDb } = await import('@/index');

const ts = (ms: number) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: 0 });

describe('userDoc', () => {
  it('fills only the missing settings paths, never an existing value', () => {
    expect(missingSettingPaths(undefined)).toEqual({ settings: DEFAULT_SETTINGS });
    expect(missingSettingPaths({ ...DEFAULT_SETTINGS })).toEqual({});
    const rules = { ...DEFAULT_SETTINGS.categoryRules } as Record<string, string>;
    delete rules.Photos;
    rules.Health = 'approve';
    expect(missingSettingPaths({ categoryRules: rules, defaultStep: 'full' })).toEqual({
      'settings.categoryRules.Photos': 'approve',
      'settings.cloudFallbackForOwnData': false,
      'settings.pushEnabled': false,
    });
    expect(missingSettingPaths({ defaultStep: 'full', cloudFallbackForOwnData: true, pushEnabled: true })).toEqual({
      'settings.categoryRules': DEFAULT_SETTINGS.categoryRules,
    });
  });

  it('reads stored settings defensively', () => {
    const s = readSettings({ categoryRules: { Money: 'never', Home: 'bogus' }, defaultStep: 'everything', pushEnabled: true });
    expect(s.categoryRules.Money).toBe('never');
    expect(s.categoryRules.Home).toBe('approve');
    expect(Object.keys(s.categoryRules)).toEqual([...CATEGORIES]);
    expect(s.defaultStep).toBe('answer');
    expect(s.pushEnabled).toBe(true);
    expect(toUserDocView({ settings: DEFAULT_SETTINGS, homeBaseDeviceId: 'dev1' })).toEqual({ settings: DEFAULT_SETTINGS, homeBaseDeviceId: 'dev1' });
    expect(toUserDocView(undefined)).toBeNull();
  });
});

describe('item refs (01 section 11.8)', () => {
  beforeEach(() => resetItemRefsForTests());

  it('is a 64-hex HMAC, stable per account and salt, different per account', async () => {
    const a = await itemRef('u1', 'folder:taxes/2025/W-2.pdf');
    expect(isItemRef(a)).toBe(true);
    expect(a).not.toContain('taxes');
    resetItemRefsForTests();
    expect(await itemRef('u1', 'folder:taxes/2025/W-2.pdf')).toBe(a);   // the salt was kept in IndexedDB
    expect(await itemRef('u2', 'folder:taxes/2025/W-2.pdf')).not.toBe(a);
    expect(await itemRef('u1', a)).toBe(a);   // already a ref (from another device)
  });

  it('joins refs back to local record ids; unknown refs map to null', async () => {
    const refs = await itemRefs('u1', ['gmail:m1', 'upload:upload-1']);
    resetItemRefsForTests();
    const foreign = 'f'.repeat(64);
    const map = await resolveItemRefs('u1', openDb('real'), [...refs, foreign]);
    expect(map).toEqual({ [refs[0]]: 'gmail:m1', [refs[1]]: 'upload:upload-1', [foreign]: null });
  });

  it('forgetting the salt makes new refs', async () => {
    const before = await itemRef('u3', 'gmail:m1');
    await forgetLocalSalt('u3');
    expect(await itemRef('u3', 'gmail:m1')).not.toBe(before);
  });
});

describe('callables (01 section 11.5, 40 section 10.5)', () => {
  it("uses 30's names", () => {
    expect(CALLABLE_NAMES).toEqual(['issueGrant', 'narrowGrant', 'revokeGrant', 'getAuditStatus', 'deleteAccount', 'issuePlaygroundGrant']);
  });

  it('maps error codes to the 10.5 copy', () => {
    const e = (code: string, message = '') => Object.assign(new Error(message), { code });
    expect(callableCode(e('functions/permission-denied'))).toBe('permission-denied');
    expect(callableMessage(e('functions/unavailable'))).toBe(CALLABLE_ERRORS.unreachable);
    expect(callableMessage(e('functions/deadline-exceeded'))).toBe(CALLABLE_ERRORS.unreachable);
    expect(callableMessage(e('functions/internal', 'internal'), false)).toBe(CALLABLE_ERRORS.unreachable);
    expect(callableMessage(e('functions/internal', 'internal'), true)).toBe(CALLABLE_ERRORS.other);
    expect(callableMessage(e('functions/permission-denied', 'Sign in with Google to connect an AI.'))).toBe(CALLABLE_ERRORS.notAllowed);
    expect(callableMessage(e('functions/unauthenticated'))).toBe(CALLABLE_ERRORS.notAllowed);
    expect(callableMessage(e('functions/failed-precondition', 'That connection has expired.'))).toBe('That connection has expired.');
    expect(callableMessage(e('functions/failed-precondition'))).toBe(CALLABLE_ERRORS.precondition);
    expect(callableMessage(e('functions/resource-exhausted', 'You already have 10 connected AIs. Remove one first.'))).toBe(
      'You already have 10 connected AIs. Remove one first.',
    );
    expect(callableMessage(e('functions/out-of-range'))).toBe(CALLABLE_ERRORS.other);
  });
});

describe('grants', () => {
  const now = 1_000_000_000;
  it('derives the state', () => {
    expect(grantState({ expiresAt: now + EXPIRING_MS + 1 }, now)).toBe('active');
    expect(grantState({ expiresAt: now + EXPIRING_MS }, now)).toBe('expiring');
    expect(grantState({ expiresAt: now }, now)).toBe('expired');
    expect(grantState({ expiresAt: now + EXPIRING_MS * 5, revokedAt: now - 1 }, now)).toBe('revoked');
  });

  it('reads a grant doc', () => {
    const g = toGrantView('g1', { aiName: 'Gemini CLI', maxStep: 'excerpt', allowedCategories: ['Home', 'Bogus'], allowedSources: ['gmail'], createdAt: ts(1), expiresAt: ts(now + EXPIRING_MS * 2), linkHint: 'ab12' }, now);
    expect(g).toMatchObject({ id: 'g1', aiName: 'Gemini CLI', maxStep: 'excerpt', allowedCategories: ['Home'], allowedSources: ['gmail'], createdAt: 1, linkHint: 'ab12', state: 'active' });
    expect(g.revokedAt).toBeUndefined();
  });
});

describe('receipts', () => {
  it('stores itemRefs, never item ids, and no undefined fields', () => {
    const r: Receipt = { id: 'r1', requestId: 'r1', requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' }, question: 'q', itemIds: ['folder:taxes/W-2.pdf'], status: 'pending-collection', chars: 3, createdAt: 5 };
    const d = receiptDoc(r, ['a'.repeat(64)]);
    expect(d).not.toHaveProperty('itemIds');
    expect(d.itemRefs).toEqual(['a'.repeat(64)]);
    expect(JSON.stringify({ ...d, createdAt: null })).not.toContain('taxes');
    expect(d).not.toHaveProperty('step');
    expect(d).not.toHaveProperty('decidedBy');
  });

  it('reads a stored receipt; malformed docs are dropped', () => {
    const v = toReceiptView('r1', { id: 'r1', requestId: 'r1', requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, question: 'Draft a reply.', itemRefs: ['b'.repeat(64)], status: 'delivered', step: 'answer', decidedBy: 'app', chars: 50, createdAt: ts(77) });
    expect(v).toEqual({ id: 'r1', requestId: 'r1', requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, question: 'Draft a reply.', itemIds: ['b'.repeat(64)], status: 'delivered', step: 'answer', decidedBy: 'app', chars: 50, createdAt: 77 });
    expect(toReceiptView('x', { status: 'delivered' })).toBeNull();
  });
});

describe('blocked and devices', () => {
  it('blockedFor matches the grant or *', () => {
    const list = [
      { id: '1', recordId: 'gmail:a', grantId: 'g1', recordRef: 'ra' },
      { id: '2', recordId: 'gmail:b', grantId: '*', recordRef: 'rb' },
      { id: '3', recordId: 'gmail:c', grantId: 'g2', recordRef: 'rc' },
    ];
    expect(blockedFor(list, 'g1')).toEqual(['gmail:a', 'gmail:b']);
    expect(blockedRefsFor(list, 'g2')).toEqual(['rb', 'rc']);
  });

  it('reads a device row', () => {
    expect(toDeviceView('dev1', { label: 'Mac mini', isHomeBase: true, fcmToken: 'fid', updatedAt: ts(9) }, 'dev1')).toEqual({
      id: 'dev1', label: 'Mac mini', isHomeBase: true, hasPush: true, updatedAt: 9, isThisDevice: true,
    });
  });
});
