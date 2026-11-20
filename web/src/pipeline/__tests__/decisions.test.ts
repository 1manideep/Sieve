import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES } from '@sieve/shared';
import type { Decision, Proposal, Settings, StepOption } from '@sieve/shared';
import { setLanguageModelForTests } from '@/ai/device/languageModel';
import { setHybridForTests } from '@/ai/hybrid';
import { createFakeHybrid } from '@/ai/testing/fakeHybrid';
import { installFakeLanguageModel } from '@/ai/testing/fakeLanguageModel';
import { resetAiForTests } from '@/ai/testing/reset';
import { fakeDb } from '@/ai/__tests__/fakeDb';
import { BODIES, RECORDS } from '@/ai/__tests__/fixtures';
import { DecisionError } from '../errors';
import { finalizeDecision } from '../finalizeDecision';
import { prepareProposal } from '../prepareProposal';
import { buildRelatedOptions } from '../related';
import { splitDraftRequest } from '../split';
import { composeOutgoingText } from '../steps';
import * as idx from './mocks/index';
import * as privacy from './mocks/privacy';

vi.mock('@/index', () => import('./mocks/index'));
vi.mock('@/privacy', () => import('./mocks/privacy'));

const SETTINGS: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
const OUTSIDE = { kind: 'outside' as const, grantId: 'g1', aiName: 'Gemini CLI' };
const db = fakeDb();

async function golden(over: Partial<Parameters<typeof prepareProposal>[0]> = {}): Promise<Proposal> {
  idx.search.mockResolvedValue([idx.cand('playground:deposit', 'vector', { start: 0, end: BODIES.deposit.length })]);
  idx.relatedFor.mockResolvedValue([idx.cand('playground:pets', 'vector', { start: 10, end: 190 })]);
  return prepareProposal({
    db, requestId: 'r1', question: 'What did my landlord say about the deposit?', requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' },
    requestedStep: 'answer', maxStep: 'full', settings: SETTINGS, dataClass: 'sample', ...over,
  });
}
const decide = (p: Proposal, over: Partial<Decision> = {}): Decision => ({
  requestId: p.requestId, approved: true, step: 'answer', itemIds: [p.item?.recordId ?? ''], decidedBy: 'app', decidedAt: p.createdAt + 60_000, ...over,
});
async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(DecisionError);
    return (e as DecisionError).code;
  }
}

describe('finalizeDecision and related items (10 section 16.11)', () => {
  beforeEach(() => {
    resetAiForTests();
    privacy.resetPrivacyMock();
    idx.resetIndexMock(Object.values(RECORDS));
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
    setHybridForTests(createFakeHybrid(() => ({ text: '{"item":"P1","answer":"Your deposit was $1,200, paid on March 3."}', source: 'on_device' })));
  });

  it('FD-1: the payload is exactly the approved option text; the in-app receipt is delivered', async () => {
    const p = await golden();
    const { payload, receipt, approveStep } = await finalizeDecision(p, decide(p));
    expect(payload).toEqual({ step: 'answer', text: p.options[0].text, chars: p.options[0].text.length, itemCount: 1 });
    expect(receipt).toMatchObject({ status: 'delivered', decidedBy: 'app', chars: p.options[0].text.length, itemIds: ['playground:deposit'], step: 'answer' });
    expect(receipt).not.toHaveProperty('text');
    expect(approveStep?.label).toBe('You approved: answer only');
  });

  it('runs the privacy pipeline\'s last check (verifyOutgoing) on a single-item payload', async () => {
    const p = await golden();
    const d = decide(p);
    const { payload } = await finalizeDecision(p, d);
    expect(privacy.verifyOutgoing).toHaveBeenCalledWith(payload, p, d);
    privacy.verifyOutgoing.mockImplementationOnce(() => {
      throw new Error('Nothing was sent: the payload text differs from the approved text.');
    });
    await expect(finalizeDecision(p, d)).rejects.toMatchObject({ code: 'option-unavailable', message: 'Nothing was sent: the payload text differs from the approved text.' });
  });

  it('FD-2: an outside requester gets a pending-collection receipt', async () => {
    const p = await golden({ requester: OUTSIDE });
    expect((await finalizeDecision(p, decide(p))).receipt.status).toBe('pending-collection');
  });

  it('FD-3 to FD-6: steps, items, requests and options are validated', async () => {
    const p = await golden({ requester: OUTSIDE, maxStep: 'answer' });
    expect(await code(finalizeDecision(p, decide(p, { step: 'full' })))).toBe('step-too-high');
    expect(await code(finalizeDecision(p, decide(p, { itemIds: ['playground:other'] })))).toBe('bad-items');
    expect(await code(finalizeDecision(p, decide(p, { requestId: 'other' })))).toBe('wrong-request');
    expect(await code(finalizeDecision(p, decide(p, { step: undefined })))).toBe('bad-step');
    const q = await golden();
    const broken: Proposal = { ...q, options: q.options.map((o, i) => (i === 1 ? { ...o, available: false, text: '' } : o)) };
    expect(await code(finalizeDecision(broken, decide(broken, { step: 'excerpt' })))).toBe('option-unavailable');
    const notReady: Proposal = { ...q, outcome: 'no-match', item: undefined };
    expect(await code(finalizeDecision(notReady, decide(q)))).toBe('not-ready');
  });

  it('FD-7: declining shares nothing and keeps the main item on the receipt', async () => {
    const p = await golden();
    const { payload, receipt, approveStep } = await finalizeDecision(p, decide(p, { approved: false, step: undefined }));
    expect(payload).toBeNull();
    expect(receipt).toMatchObject({ status: 'declined', chars: 0, itemIds: ['playground:deposit'], decidedBy: 'app' });
    expect(approveStep?.label).toBe('You declined: nothing was shared');
  });

  it('FD-8: a related item at the excerpt step joins the outgoing text', async () => {
    const p = await golden();
    expect(p.related.map((c) => c.recordId)).toEqual(['playground:pets']);
    const related = await buildRelatedOptions({ db, proposal: p, recordId: 'playground:pets', dataClass: 'sample' });
    expect(related.map((o) => [o.step, o.available])).toEqual([['answer', false], ['excerpt', true], ['full', true]]);
    expect(related[0].unavailableReason).toBe('Related items can be shared as an excerpt or the full item.');
    expect(related[1].text.startsWith('Also shared: Lease_2026.pdf, section 12 (Mar 4, 2026)\n')).toBe(true);
    expect(related[1].chars).toBe(related[1].text.length);
    const { payload } = await finalizeDecision(p, decide(p, { step: 'excerpt', itemIds: ['playground:deposit', 'playground:pets'] }), {
      relatedOptions: { 'playground:pets': related },
    });
    expect(payload?.text).toBe(composeOutgoingText([p.options[1], related[1]]));
    expect(payload?.itemCount).toBe(2);
  });

  it('FD-8b: a related item gets the same share-time Nano check, on its own outgoing text (11 section 10.7)', async () => {
    const p = await golden();
    privacy.checkOutgoing.mockClear();
    privacy.buildStepOption.mockClear();
    const step = { kind: 'pii' as const, label: 'Found and masked 1 name in the text to share', where: 'device' as const, ms: 30, at: 1 };
    privacy.checkOutgoing.mockResolvedValueOnce({ entities: [{ text: 'Dana', type: 'name', by: 'nano' }], quotes: [], trace: [step], nanoPii: true, ran: 2, shareChecks: [{ key: 'k' }] });
    const related = await buildRelatedOptions({ db, proposal: p, recordId: 'playground:pets', dataClass: 'sample' });
    expect(privacy.checkOutgoing).toHaveBeenCalledTimes(1);
    expect(privacy.checkOutgoing.mock.calls[0]![2].map((o) => o.step)).toEqual(['excerpt', 'full']);
    expect(privacy.buildStepOption).toHaveBeenCalledTimes(4);              // built, then built again with what Nano found
    expect(privacy.buildStepOption.mock.calls[2]![4]).toMatchObject({ extraEntities: [{ text: 'Dana', type: 'name', by: 'nano' }], extraQuotes: [] });
    expect(related[2].trace).toContainEqual(step);
    expect(idx.patchRecord).toHaveBeenCalledWith(db, 'playground:pets', expect.any(Number), { shareChecks: [{ key: 'k' }] });
  });

  it('FD-9: a related item cannot be shared at the answer step; unknown items are refused', async () => {
    const p = await golden();
    const related = await buildRelatedOptions({ db, proposal: p, recordId: 'playground:pets', dataClass: 'sample' });
    expect(await code(finalizeDecision(p, decide(p, { itemIds: ['playground:deposit', 'playground:pets'] }), { relatedOptions: { 'playground:pets': related } }))).toBe(
      'option-unavailable',
    );
    await expect(buildRelatedOptions({ db, proposal: p, recordId: 'playground:bank', dataClass: 'sample' })).rejects.toMatchObject({ code: 'bad-items' });
    idx.verifyFresh.mockResolvedValueOnce('gone');
    const gone = await buildRelatedOptions({ db, proposal: p, recordId: 'playground:pets', dataClass: 'sample' });
    expect(gone.every((o) => !o.available && o.unavailableReason === "This item was deleted, so it can't be shared.")).toBe(true);
  });

  it('FD-10: with the db, a deleted or changed item stops the send', async () => {
    const p = await golden();
    idx.verifyFresh.mockResolvedValueOnce('gone');
    await expect(finalizeDecision(p, decide(p), { db })).rejects.toMatchObject({ code: 'not-ready', message: 'That item was deleted, so nothing was sent.' });
    idx.verifyFresh.mockResolvedValueOnce('changed');
    await expect(finalizeDecision(p, decide(p), { db })).rejects.toMatchObject({
      message: 'That item changed after Sieve read it. Ask again to see the new text.',
    });
    expect((await finalizeDecision(p, decide(p), { db })).payload?.text).toBe(p.options[0].text);
  });

  it('FD-11: a decision more than 24 hours after the proposal has expired', async () => {
    const p = await golden();
    expect(await code(finalizeDecision(p, decide(p, { decidedAt: p.createdAt + 25 * 3600_000 })))).toBe('expired');
  });

  it('re-checks the current rules and blocks at send time (01 section 11.8)', async () => {
    const p = await golden({ requester: OUTSIDE });
    const neverHome = { ...SETTINGS, categoryRules: { ...SETTINGS.categoryRules, Home: 'never' as const } };
    await expect(finalizeDecision(p, decide(p), { db, current: { settings: neverHome } })).rejects.toMatchObject({ code: 'not-ready' });
    await expect(finalizeDecision(p, decide(p), { db, current: { blockedRecordIds: ['playground:deposit'] } })).rejects.toMatchObject({ code: 'not-ready' });
    await expect(finalizeDecision(p, decide(p), { db, current: { allowedCategories: ['Work'] } })).rejects.toMatchObject({ code: 'not-ready' });
  });

  it('an option over 8,000 characters is never offered', async () => {
    privacy.buildStepOption.mockImplementation(async (step, parts) => {
      const text = step === 'full' ? 'x'.repeat(8001) : (parts[step] ?? '');
      return { step, text, chars: text.length, redactions: 0, available: !!text } satisfies StepOption;
    });
    const p = await golden();
    expect(p.options[2]).toMatchObject({ available: false, unavailableReason: 'This is more than Sieve sends at once (8,000 characters).' });
  });
});

describe('splitDraftRequest (FD-12)', () => {
  const rows: [string, string, string | null][] = [
    ['What did my landlord say about the deposit? Draft a reply.', 'What did my landlord say about the deposit?', 'Draft a reply.'],
    ['Find the email from my landlord about the deposit and draft a reply.', 'Find the email from my landlord about the deposit', 'Draft a reply.'],
    ['Draft a reply to my landlord about the deposit', 'my landlord about the deposit', 'Draft a reply to my landlord about the deposit'],
    ["What's my latest bank balance?", "What's my latest bank balance?", null],
    ['Write down the flight time for Seattle', 'Write down the flight time for Seattle', null],
    ['When does my flight leave, then write a short email to Priya', 'When does my flight leave', 'Write a short email to Priya'],
    ['Can you draft a polite reply to the parcel email?', 'the parcel email?', 'Draft a polite reply to the parcel email?'],
  ];
  it.each(rows)('%s', (input, lookup, instruction) => {
    expect(splitDraftRequest(input)).toEqual({ lookup, instruction });
  });
});
