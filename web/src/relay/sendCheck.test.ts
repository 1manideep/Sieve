import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_RULES, type IndexRecord, type Settings } from '@sieve/shared';
import { SEND_CHECK } from '@/copy/strings';
import { checkBeforeSend, type SendCheckInput } from './sendCheck';

const rec = (id: string, over: Partial<IndexRecord> = {}): IndexRecord => ({
  id, source: 'gmail', sourceRef: id, kind: 'email', title: 't', date: 1, preview: '', category: 'Home', categoryBy: 'code',
  hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: 1, contentHash: 'h', version: 1, ...over,
});
const settings: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
const records: Record<string, IndexRecord> = { 'gmail:a': rec('gmail:a'), 'gmail:money': rec('gmail:money', { category: 'Money' }), 'folder:x': rec('folder:x', { source: 'folder' }) };

function input(over: Partial<SendCheckInput> = {}): SendCheckInput {
  return {
    step: 'answer',
    approvedText: 'hello',
    payloadText: 'hello',
    itemIds: ['gmail:a'],
    requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' },
    settings,
    blockedRecordIds: [],
    request: { status: 'awaiting-person', maxStep: 'full', allowedCategories: ['Home', 'Money'], allowedSources: ['gmail'], deadline: 100 },
    now: 50,
    getRecord: async (id) => records[id],
    ...over,
  };
}

describe('checkBeforeSend (70 section 3.3)', () => {
  it('passes, with a code trace step', async () => {
    const r = await checkBeforeSend(input());
    expect(r).toMatchObject({ ok: true, trace: { kind: 'rule', where: 'code', label: SEND_CHECK.passedTrace } });
  });

  it.each([
    ['text-mismatch', { payloadText: 'hello!' }, SEND_CHECK.textMismatch],
    ['empty', { approvedText: '', payloadText: '' }, SEND_CHECK.empty],
    ['too-long', { approvedText: 'x'.repeat(8001), payloadText: 'x'.repeat(8001) }, SEND_CHECK.tooLong],
    ['missing-item', { itemIds: ['gmail:gone'] }, SEND_CHECK.missingItem],
    ['rule-never', { settings: { ...settings, categoryRules: { ...settings.categoryRules, Home: 'never' } } }, SEND_CHECK.ruleNever('Home')],
    ['request-closed', { request: { ...input().request!, status: 'answered' } }, SEND_CHECK.requestClosed],
    ['expired', { now: 100 }, SEND_CHECK.expired],
    ['step-too-high', { step: 'full', request: { ...input().request!, maxStep: 'excerpt' } }, SEND_CHECK.stepTooHigh('Gemini CLI')],
    ['category-not-allowed', { itemIds: ['gmail:money'], request: { ...input().request!, allowedCategories: ['Home'] } }, SEND_CHECK.categoryNotAllowed('Gemini CLI', 'Money')],
    ['source-not-allowed', { itemIds: ['folder:x'] }, SEND_CHECK.sourceNotAllowed('Gemini CLI', 'folder')],
    ['blocked', { blockedRecordIds: ['gmail:a'] }, SEND_CHECK.blocked('Gemini CLI')],
  ] as const)('%s', async (code, over, message) => {
    const r = await checkBeforeSend(input(over as Partial<SendCheckInput>));
    expect(r).toMatchObject({ ok: false, code, message });
    if (!r.ok) expect(r.trace.label).toBe(SEND_CHECK.stoppedTrace(message));
    expect(message.endsWith('Nothing was sent.')).toBe(true);
  });

  it('names the source in plain words', () => {
    expect(SEND_CHECK.sourceNotAllowed('Gemini CLI', 'gmail')).toBe('Gemini CLI may no longer use your Gmail. Nothing was sent.');
    expect(SEND_CHECK.stoppedTrace(SEND_CHECK.blocked('Gemini CLI'))).toBe('Stopped just before sending: You blocked this item for Gemini CLI.');
  });
});
