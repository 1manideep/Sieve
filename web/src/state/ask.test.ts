import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES, LADDER_STEPS, type Decision, type IndexRecord, type Proposal, type Receipt } from '@sieve/shared';
import type { PrepareInput } from '@/pipeline';
import { ASK_FLOW, DECIDE_ERRORS, DRAFT_ERRORS } from '@/copy/strings';
import { compose, option, proposal, T0 } from '@/relay/__tests__/fixtures';

const calls: string[] = [];
const receiptsPut = vi.fn(async (r: Receipt) => {
  calls.push('db.receipts.put');
  return r.id;
});
const consentsPut = vi.fn(async () => undefined);
const fakeDb = { name: 'db', receipts: { put: receiptsPut }, consents: { put: consentsPut } };
const records: Record<string, IndexRecord> = {
  'gmail:m1': { id: 'gmail:m1', source: 'gmail', sourceRef: 'm1', kind: 'email', title: 't', date: T0, preview: '', category: 'Home', categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: T0, contentHash: 'h', version: 1 },
  'playground:e1': { id: 'playground:e1', source: 'playground', sourceRef: 'e1', kind: 'email', title: 't', date: T0, preview: '', category: 'Home', categoryBy: 'seed', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: T0, contentHash: 'h', version: 1 },
};

const prepareProposal = vi.fn(async (input: PrepareInput): Promise<Proposal> => {
  input.onProgress?.({ type: 'step-start', id: 'x:1', kind: 'answer', label: 'Reading 3 emails on this device…', where: 'device' });
  input.onProgress?.({ type: 'answer-progress', text: 'Your deposit' });
  input.onProgress?.({ type: 'step-end', id: 'x:1', step: { kind: 'answer', label: 'Read 3 emails in 9 s', where: 'device', ms: 9000, at: T0 } });
  return proposal({ requestId: input.requestId, requester: input.requester, maxStep: 'full', question: input.question });
});
const finalizeDecision = vi.fn(async (p: Proposal, d: Decision) => {
  calls.push('finalizeDecision');
  const i = LADDER_STEPS.indexOf(d.step!);
  const text = p.options[i].text;
  return {
    payload: { step: d.step!, text, chars: text.length, itemCount: d.itemIds.length },
    receipt: { id: 'rcpt1', requestId: p.requestId, requester: p.requester, question: p.question, step: d.step, itemIds: d.itemIds, status: 'delivered', decidedBy: 'app', chars: text.length, createdAt: d.decidedAt } as Receipt,
  };
});
const buildRelatedOptions = vi.fn(async () => [option('answer', '', { available: false }), option('excerpt', 'rel e'), option('full', 'rel f')]);
vi.mock('@/pipeline', () => ({ prepareProposal, finalizeDecision, buildRelatedOptions, composeOutgoingText: compose }));
vi.mock('@/index', () => ({ openDb: () => fakeDb, getRecord: async (_db: unknown, id: string) => records[id] }));

const draftReply = vi.fn(async (text: string, instruction: string) => {
  calls.push(`draftReply:${text}|${instruction}`);
  return { ok: true as const, value: { draft: 'Hi, thanks.' }, trace: { kind: 'draft' as const, label: 'Drafted', where: 'cloud' as const, ms: 900, at: T0, charsSent: text.length } };
});
vi.mock('@/ai', () => ({ draftReply, getNanoAvailability: async () => ({ text: 'available', image: 'available' }) }));

const saveReceipt = vi.fn(async (_uid: string, _r: Receipt) => {
  calls.push('saveReceipt');
});
vi.mock('@/app/services/receipts', () => ({ saveReceipt }));

const { createAskStore, startingStep, draftErrorFor } = await import('./ask');
const { useNetwork } = await import('./network');
const { useSettings } = await import('./settings');
const { useSession } = await import('./session');
const { useToasts } = await import('./toasts');

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  useNetwork.setState({ online: true });
  useSettings.setState({ settings: { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false } });
  useSession.setState({ user: { uid: 'u1', isAnonymous: false }, kind: 'google' });
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAsk: ask', () => {
  it('runs prepareProposal with the in-app requester and fills the live trace', async () => {
    const store = createAskStore('real');
    await store.getState().ask('What did my landlord say about the deposit?');
    const input = prepareProposal.mock.calls[0][0];
    expect(input).toMatchObject({ requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, requestedStep: 'answer', maxStep: 'full', dataClass: 'own' });
    const s = store.getState();
    expect(s.phase).toBe('ready');
    expect(s.liveSteps).toHaveLength(1);
    expect(s.liveSteps[0]).toMatchObject({ status: 'done', label: 'Read 3 emails in 9 s' });
    expect(s.step).toBe('answer');
    expect(s.answerPreview).toBe('');
  });

  it('an empty question shows the error and does nothing else', async () => {
    const store = createAskStore('real');
    await store.getState().ask('   ');
    expect(store.getState().error).toBe(ASK_FLOW.emptyQuestion);
    expect(prepareProposal).not.toHaveBeenCalled();
  });

  it('keeps the question asked apart from the box: the box is left as it is, Allow the cloud asks the same question', async () => {
    const store = createAskStore('real');
    await store.getState().ask('What did my landlord say about the deposit?');
    expect(store.getState()).toMatchObject({ question: '', asked: 'What did my landlord say about the deposit?', phase: 'ready' });
    store.getState().setQuestion('a follow-up being typed');
    await store.getState().allowCloudFor('gmail:m1');
    expect(consentsPut).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'gmail:m1' }));
    expect(prepareProposal).toHaveBeenCalledTimes(2);
    expect(prepareProposal.mock.calls[1][0].question).toBe('What did my landlord say about the deposit?');
    expect(store.getState()).toMatchObject({ question: 'a follow-up being typed', asked: 'What did my landlord say about the deposit?' });
  });

  it('stop returns to idle; a timeout is an error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    prepareProposal.mockImplementationOnce(
      (i: PrepareInput) => new Promise((resolve) => i.signal?.addEventListener('abort', () => resolve(proposal({ outcome: 'error' })))),
    );
    const store = createAskStore('playground');
    const run = store.getState().ask('q');
    await vi.advanceTimersByTimeAsync(0);
    store.getState().stop();
    await run;
    expect(store.getState().phase).toBe('idle');
    prepareProposal.mockImplementationOnce(
      (i: PrepareInput) => new Promise((resolve) => i.signal?.addEventListener('abort', () => resolve(proposal({ outcome: 'error' })))),
    );
    const run2 = store.getState().ask('q');
    await vi.advanceTimersByTimeAsync(120_000);
    await run2;
    expect(store.getState()).toMatchObject({ phase: 'error', error: ASK_FLOW.tooSlow });
  });
});

describe('useAsk: approveAndDraft', () => {
  it('order: finalizeDecision, then saveReceipt (question replaced by the instruction, chars include it), then draftReply', async () => {
    const store = createAskStore('real');
    await store.getState().ask('What did my landlord say about the deposit?');
    store.getState().setInstruction('Draft a reply.');
    await store.getState().approveAndDraft();
    expect(calls).toEqual(['finalizeDecision', 'saveReceipt', `draftReply:${proposal().options[0].text}|Draft a reply.`]);
    const [uid, saved] = saveReceipt.mock.calls[0];
    expect(uid).toBe('u1');
    expect(saved.question).toBe('Draft a reply.');
    expect(saved.chars).toBe(proposal().options[0].text.length + 'Draft a reply.'.length);
    const s = store.getState();
    expect(s.phase).toBe('done');
    expect(s.draft).toBe('Hi, thanks.');
    expect(s.outcome).toMatchObject({ kind: 'shared', receiptId: 'rcpt1', step: 'answer', itemCount: 1, chars: saved.chars });
    expect(s.extraTrace.map((t) => t.kind)).toEqual(['approve', 'draft']);
    expect(s.extraTrace[0].label).toBe('You approved: Answer only');
  });

  it('offline: nothing is approved and nothing is written', async () => {
    const store = createAskStore('real');
    await store.getState().ask('q');
    useNetwork.setState({ online: false });
    await store.getState().approveAndDraft();
    expect(store.getState().draftError).toBe(ASK_FLOW.offlineDraft);
    expect(finalizeDecision).not.toHaveBeenCalled();
    expect(saveReceipt).not.toHaveBeenCalled();
    expect(draftReply).not.toHaveBeenCalled();
  });

  it('maps every draft error code; a failed draft keeps the receipt and "Try again" writes no second one', async () => {
    expect(draftErrorFor('quota')).toBe(DRAFT_ERRORS.quota);
    expect(draftErrorFor('app-check')).toBe(DRAFT_ERRORS.appCheck);
    expect(draftErrorFor('timeout')).toBe(DRAFT_ERRORS.timeout);
    expect(draftErrorFor('too-long')).toBe(DRAFT_ERRORS.tooLong);
    expect(draftErrorFor('bad-output')).toBe(DRAFT_ERRORS.badOutput);
    expect(draftErrorFor('aborted')).toBeNull();
    expect(draftErrorFor('unknown')).toBe(DRAFT_ERRORS.other);
    draftReply.mockResolvedValueOnce({ ok: false, error: { code: 'quota', message: 'busy' }, trace: { kind: 'draft', label: 'x', where: 'cloud', ms: 1, at: T0 } } as never);
    const store = createAskStore('real');
    await store.getState().ask('q');
    await store.getState().approveAndDraft();
    expect(store.getState()).toMatchObject({ phase: 'done', draftError: DRAFT_ERRORS.quota, outcome: { kind: 'shared' } });
    await store.getState().approveAndDraft();
    expect(saveReceipt).toHaveBeenCalledTimes(1);
    expect(draftReply).toHaveBeenCalledTimes(2);
    expect(store.getState().draft).toBe('Hi, thanks.');
  });

  it('retryDraft runs only draftReply for the approved text and instruction; it does nothing before a failed draft', async () => {
    const store = createAskStore('real');
    const before = Date.now();
    const asked = store.getState().ask('q');
    expect(store.getState().startedAt).toBeGreaterThanOrEqual(before);
    await asked;
    await store.getState().retryDraft();
    expect(draftReply).not.toHaveBeenCalled();
    draftReply.mockResolvedValueOnce({ ok: false, error: { code: 'timeout', message: 'slow' }, trace: { kind: 'draft', label: 'x', where: 'cloud', ms: 1, at: T0 } } as never);
    await store.getState().approveAndDraft();
    expect(store.getState()).toMatchObject({ phase: 'done', draftError: DRAFT_ERRORS.timeout });
    store.getState().setInstruction('Something else.');
    calls.length = 0;
    await store.getState().retryDraft();
    expect(calls).toEqual([`draftReply:${proposal().options[0].text}|Draft a short, polite reply.`]);
    expect(finalizeDecision).toHaveBeenCalledTimes(1);
    expect(saveReceipt).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ phase: 'done', draft: 'Hi, thanks.', draftError: undefined, outcome: { kind: 'shared' } });
  });

  it('a payload that differs from the composed text stops with a toast', async () => {
    finalizeDecision.mockImplementationOnce(async (p: Proposal, d: Decision) => ({
      payload: { step: d.step!, text: 'something else', chars: 14, itemCount: 1 },
      receipt: { id: 'r', requestId: p.requestId, requester: p.requester, question: p.question, itemIds: d.itemIds, status: 'delivered', chars: 14, createdAt: 1 } as Receipt,
    }));
    const store = createAskStore('real');
    await store.getState().ask('q');
    await store.getState().approveAndDraft();
    expect(saveReceipt).not.toHaveBeenCalled();
    expect(draftReply).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.at(-1)?.title).toBe(ASK_FLOW.mismatch);
  });

  it('keepLocal writes no receipt', async () => {
    const store = createAskStore('real');
    await store.getState().ask('q');
    store.getState().keepLocal();
    expect(store.getState()).toMatchObject({ phase: 'done', outcome: { kind: 'kept-local' } });
    expect(saveReceipt).not.toHaveBeenCalled();
    expect(receiptsPut).not.toHaveBeenCalled();
  });

  it('Playground receipts go to db.receipts with the original question', async () => {
    prepareProposal.mockImplementationOnce(async (input: PrepareInput) =>
      proposal({ requestId: input.requestId, requester: input.requester, question: input.question, item: { ...proposal().item!, recordId: 'playground:e1' } }),
    );
    const store = createAskStore('playground');
    await store.getState().ask('What did my landlord say?');
    expect(prepareProposal.mock.calls[0][0].dataClass).toBe('sample');
    await store.getState().approveAndDraft();
    expect(saveReceipt).not.toHaveBeenCalled();
    const put = receiptsPut.mock.calls[0][0];
    expect(put.question).toBe('What did my landlord say?');
    expect(put.chars).toBe(proposal().options[0].text.length + 'Draft a short, polite reply.'.length);
    expect(calls.indexOf('db.receipts.put')).toBeLessThan(calls.findIndex((c) => c.startsWith('draftReply')));
  });

  it('ticking a related item that cannot be built unticks it and marks the row', async () => {
    buildRelatedOptions.mockRejectedValueOnce(new Error('x'));
    const store = createAskStore('real');
    await store.getState().ask('q');
    await store.getState().toggleRelated('gmail:m2');
    expect(store.getState()).toMatchObject({ relatedSelected: [], relatedFailed: ['gmail:m2'], relatedLoading: [] });
  });

  it('a related item without an answer step moves the step to the smallest available one', async () => {
    const store = createAskStore('real');
    await store.getState().ask('q');
    store.getState().setStep('answer');
    await store.getState().toggleRelated('gmail:m2');
    expect(store.getState().step).toBe('excerpt');
  });
});

describe('useAsk: an old approval never writes over a new question', () => {
  it('a new question while finalizeDecision runs: the old approval stops, nothing is saved or drafted', async () => {
    const store = createAskStore('real');
    await store.getState().ask('first question');
    let release!: () => void;
    finalizeDecision.mockImplementationOnce(async (p: Proposal, d: Decision) => {
      await new Promise<void>((r) => {
        release = r;
      });
      const text = p.options[0].text;
      return {
        payload: { step: d.step!, text, chars: text.length, itemCount: 1 },
        receipt: { id: 'old', requestId: p.requestId, requester: p.requester, question: p.question, step: d.step, itemIds: d.itemIds, status: 'delivered', decidedBy: 'app', chars: text.length, createdAt: d.decidedAt } as Receipt,
      };
    });
    const approving = store.getState().approveAndDraft();
    await vi.waitFor(() => expect(finalizeDecision).toHaveBeenCalled());
    expect(store.getState().approving).toBe(true);
    await store.getState().ask('second question');
    expect(store.getState()).toMatchObject({ asked: 'second question', phase: 'ready', approving: false });
    // the new question can be approved while the old approval is still waiting
    release();
    await approving;
    const s = store.getState();
    expect(s).toMatchObject({ asked: 'second question', phase: 'ready', draft: undefined, outcome: undefined, draftError: undefined });
    expect(s.extraTrace).toEqual([]);
    expect(saveReceipt).not.toHaveBeenCalled();
    expect(draftReply).not.toHaveBeenCalled();
  });

  it('a new question while the draft runs: the old draft does not land on it', async () => {
    const store = createAskStore('real');
    await store.getState().ask('first question');
    let release!: () => void;
    draftReply.mockImplementationOnce(async (text: string) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return { ok: true as const, value: { draft: 'Old draft.' }, trace: { kind: 'draft' as const, label: 'Drafted', where: 'cloud' as const, ms: 900, at: T0, charsSent: text.length } };
    });
    const approving = store.getState().approveAndDraft();
    await vi.waitFor(() => expect(store.getState().phase).toBe('drafting'));
    await store.getState().ask('second question');
    release();
    await approving;
    const s = store.getState();
    expect(s).toMatchObject({ asked: 'second question', phase: 'ready', draft: undefined, outcome: undefined });
    expect(s.extraTrace).toEqual([]);
    // and the new question's own approval runs normally
    await store.getState().approveAndDraft();
    expect(store.getState()).toMatchObject({ phase: 'done', draft: 'Hi, thanks.' });
  });

  it('a step that is not available says so instead of doing nothing', async () => {
    const store = createAskStore('real');
    prepareProposal.mockImplementationOnce(async (input: PrepareInput) => {
      const p = proposal({ requestId: input.requestId, requester: input.requester, maxStep: 'full', question: input.question });
      return { ...p, options: p.options.map((o) => ({ ...o, available: false })) };
    });
    await store.getState().ask('q');
    await store.getState().approveAndDraft();
    expect(store.getState().draftError).toBe(DECIDE_ERRORS.invalidStep);
    expect(finalizeDecision).not.toHaveBeenCalled();
  });
});

describe('startingStep', () => {
  it('uses the default, else the highest below, else the lowest above', () => {
    const opts = (a: boolean, e: boolean, f: boolean) => [option('answer', 'a', { available: a }), option('excerpt', 'e', { available: e }), option('full', 'f', { available: f })];
    expect(startingStep(opts(true, true, true), 'excerpt')).toBe('excerpt');
    expect(startingStep(opts(true, false, true), 'excerpt')).toBe('answer');
    expect(startingStep(opts(false, false, true), 'excerpt')).toBe('full');
  });
});
