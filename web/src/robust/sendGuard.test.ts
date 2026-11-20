// 70 section 3.3 with outputs.json guard-* (R-OUT-05, R-OUT-06), every check in order, on a real (fake-indexeddb) db.
import { DEFAULT_CATEGORY_RULES, type IndexRecord, type Settings } from '@sieve/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { corpus } from '../../../tests/harness/robustCorpus';
import { forgetDb, openDbNamed, type SieveDb } from '@/index/db';
import { SEND_GUARD } from './copy';
import { checkBeforeSend, type SendCheckInput } from './sendGuard';

const rec = (id: string, over: Partial<IndexRecord> = {}): IndexRecord => ({
  id, source: 'gmail', sourceRef: id.split(':')[1] ?? id, kind: 'email', title: 'Re: Deposit for the apartment', date: 1, preview: '',
  category: 'Home', categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: 1, contentHash: 'h', version: 1, ...over,
});
const settings: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
const TEXT = 'The deposit is $1,200 and comes back within 21 days.';

let db: SieveDb;
let n = 0;

beforeEach(async () => {
  const name = `sieve-robust-guard-${process.pid}-${++n}`;
  db = openDbNamed(name, 'real');
  await db.records.bulkPut([rec('gmail:a'), rec('gmail:money', { category: 'Money' }), rec('folder:Taxes/W-2.pdf', { source: 'folder', category: 'Money' })]);
});

afterEach(async () => {
  db.close();
  forgetDb(db.name);
  await db.delete();
});

function input(over: Partial<SendCheckInput> = {}): SendCheckInput {
  return {
    db,
    step: 'answer',
    approvedText: TEXT,
    payloadText: TEXT,
    itemIds: ['gmail:money'],
    question: 'how much was the deposit?',
    requester: { kind: 'outside', grantId: 'grant-g', aiName: 'Helper' },
    settings,
    blockedRecordIds: [],
    request: { status: 'awaiting-person', maxStep: 'excerpt', allowedCategories: ['Home', 'Money'], allowedSources: ['gmail', 'folder'], expireAt: 1_000 },
    now: 500,
    ...over,
  };
}

describe('checkBeforeSend: outputs.json guard-*', () => {
  type G = { change?: string; category?: string; to?: string; removeCategory?: string; maxStep?: 'answer' | 'excerpt'; step?: 'answer' | 'excerpt'; payload?: string; question?: string };
  const guardCases = corpus<G, { code?: string; message?: string; ok?: boolean }>('outputs.json').cases.filter((c) => c.id.startsWith('guard-'));
  for (const c of guardCases) {
    it(c.id, async () => {
      const g = c.input;
      const base = input();
      let over: Partial<SendCheckInput> = {};
      if (g.change === 'rule') over = { settings: { ...settings, categoryRules: { ...settings.categoryRules, Money: 'never' } } };
      if (g.change === 'grant' && g.removeCategory) over = { request: { ...base.request!, allowedCategories: ['Home'] } };
      if (g.change === 'grant' && g.maxStep) over = { step: g.step ?? 'excerpt', request: { ...base.request!, maxStep: g.maxStep } };
      if (g.change === 'block') over = { blockedRecordIds: ['gmail:money'] };
      if (g.change === 'revoke') over = { request: { ...base.request!, status: 'revoked' } };
      if (g.change === 'expire') over = { now: 1_000 };
      if (g.payload !== undefined) over = { approvedText: g.payload, payloadText: g.payload, ...(g.question ? { question: g.question } : {}) };
      const r = await checkBeforeSend({ ...base, ...over });
      if (c.expected.ok) {
        expect(r.ok).toBe(true);
        return;
      }
      expect(r).toMatchObject({ ok: false, code: c.expected.code, message: c.expected.message });
      expect(r.trace).toMatchObject({ kind: 'rule', where: 'code' });
      expect(r.trace.label).toBe(`Stopped just before sending: ${(c.expected.message ?? '').replace(/ Nothing was sent\.$/, '')}`);
    });
  }
});

describe('checkBeforeSend: every check, in order', () => {
  it('passes with the pass trace', async () => {
    const r = await checkBeforeSend(input());
    expect(r).toEqual({ ok: true, trace: { kind: 'rule', where: 'code', label: SEND_GUARD.passedTrace, ms: 0, at: 500 } });
  });

  it.each<[string, Partial<SendCheckInput>, string]>([
    ['text-mismatch', { payloadText: `${TEXT} ` }, SEND_GUARD.textMismatch],
    ['empty', { approvedText: '', payloadText: '' }, SEND_GUARD.empty],
    ['too-long', { approvedText: 'x'.repeat(8001), payloadText: 'x'.repeat(8001) }, SEND_GUARD.tooLong],
    ['not-clean (lone surrogate)', { approvedText: 'a\uD800', payloadText: 'a\uD800' }, SEND_GUARD.notClean],
    ['not-clean (bidi)', { approvedText: 'a\u202Eb', payloadText: 'a\u202Eb' }, SEND_GUARD.notClean],
    ['missing-item', { itemIds: ['gmail:money', 'gmail:gone'] }, SEND_GUARD.missingItem],
    ['source-not-allowed', { itemIds: ['folder:Taxes/W-2.pdf'], request: { status: 'awaiting-person', maxStep: 'full', allowedCategories: ['Money'], allowedSources: ['gmail'], expireAt: 1_000 } }, SEND_GUARD.sourceNotAllowed('Helper', 'folder')],
    ['claimed is not awaiting-person', { request: { status: 'claimed', maxStep: 'full', allowedCategories: ['Money'], allowedSources: ['gmail'], expireAt: 1_000 } }, SEND_GUARD.requestClosed],
  ])('%s', async (_name, over, message) => {
    const r = await checkBeforeSend(input(over));
    expect(r).toMatchObject({ ok: false, message });
  });

  it('exactly 8,000 units is allowed', async () => {
    const t = 'x'.repeat(8000);
    expect((await checkBeforeSend(input({ approvedText: t, payloadText: t }))).ok).toBe(true);
  });

  it('the first failing check wins: a mismatch beats an expired request', async () => {
    const r = await checkBeforeSend(input({ payloadText: 'other', now: 5_000 }));
    expect(r).toMatchObject({ ok: false, code: 'text-mismatch' });
  });

  it('in-app requests skip the request checks but keep rules, blocks and numbers', async () => {
    const inApp = input({ requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, request: undefined, step: 'full' });
    expect((await checkBeforeSend(inApp)).ok).toBe(true);
    const never = await checkBeforeSend({ ...inApp, settings: { ...settings, categoryRules: { ...settings.categoryRules, Money: 'never' } } });
    expect(never).toMatchObject({ ok: false, code: 'rule-never', message: SEND_GUARD.ruleNever('Money') });
  });

  it.each<[string, 'card' | 'iban' | 'ssn']>([
    ['Card 4111 1111 1111 1111 was charged.', 'card'],
    ['Wire to GB82 WEST 1234 5698 7654 32 today.', 'iban'],
    // 078-05-1120 is the SSA-voided number printed on 1938 wallet inserts. The sample range 987-65-432x is never flagged:
    // 11's validator rejects areas 900 to 999, as the SSA does.
    ['SSN 078-05-1120 on the form.', 'ssn'],
  ])('unmasked number: %s', async (text, type) => {
    const r = await checkBeforeSend(input({ approvedText: text, payloadText: text }));
    expect(r).toMatchObject({ ok: false, code: 'unmasked-number', message: SEND_GUARD.unmaskedNumber(type) });
  });

  it('a masked token is fine', async () => {
    const t = 'Charged to [card ending 1111] for the deposit.';
    expect((await checkBeforeSend(input({ approvedText: t, payloadText: t }))).ok).toBe(true);
  });

  it('never edits the text', async () => {
    const i = input();
    await checkBeforeSend(i);
    expect(i.payloadText).toBe(TEXT);
  });
});
