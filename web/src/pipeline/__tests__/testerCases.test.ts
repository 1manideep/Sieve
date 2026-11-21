// The Nov 20 tester's cases (Claude with a Gmail connector versus Sieve, answer-only level), replayed on small fixtures:
// T02 a field that only looks like the answer, T03 and T04 the latest item, T05 a count, T10 a one-time code.
// Sender and date filters (T05, T06, T07, T10) are in index/search.test.ts; T08 in relay/homeBaseEngine.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES } from '@sieve/shared';
import type { Proposal, Settings } from '@sieve/shared';
import { setLanguageModelForTests } from '@/ai/device/languageModel';
import { setHybridForTests } from '@/ai/hybrid';
import { createFakeHybrid, promptText, type FakeHybrid } from '@/ai/testing/fakeHybrid';
import { installFakeLanguageModel } from '@/ai/testing/fakeLanguageModel';
import { resetAiForTests } from '@/ai/testing/reset';
import { fakeDb } from '@/ai/__tests__/fakeDb';
import { record } from '@/ai/__tests__/fixtures';
import { UNAVAILABLE } from '../copy';
import { prepareProposal } from '../prepareProposal';
import type { PrepareInput } from '../types';
import * as idx from './mocks/index';
import * as privacy from './mocks/privacy';

vi.mock('@/index', () => import('./mocks/index'));
vi.mock('@/privacy', () => import('./mocks/privacy'));

const SETTINGS: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
const OUTSIDE = { kind: 'outside' as const, grantId: 'g1', aiName: 'Claude' };
const DAY = 86_400_000;
const T = new Date(2026, 10, 18, 9, 0).getTime();
let db = fakeDb();
let hybrid: FakeHybrid;

const GOOD_DOG = record({
  id: 'gmail:gooddog', source: 'gmail', title: 'Bella: your booking is confirmed', from: 'Good Dog Daycare <hello@gooddog.example>', category: 'Personal', date: T - 5 * DAY,
  text: 'Booking confirmed for Bella. Drop-off Jun 10 at 8 AM. Pickup Jun 12 at 5 PM. Vaccines on file: rabies, valid to March 2027.',
});
const ZILLOW = record({
  id: 'gmail:zillow', source: 'gmail', title: 'Your Zillow verification code', from: 'Zillow <no-reply@zillow.com>', category: 'Home', date: T - DAY,
  text: 'Your Zillow verification code is 733211. It expires in 10 minutes. If you did not ask for it, you can ignore this email.',
});
const RAMKI = [3, 9, 1, 14].map((ago, i) =>
  record({
    id: `gmail:ramki-${i}`, source: 'gmail', title: `Notes ${i}`, from: 'Ramki <ramki@inbox.example>', category: 'Work', date: T - ago * DAY,
    text: `Ramki here. Update number ${i} on the release plan.`,
  }),
);

function input(over: Partial<PrepareInput> = {}): PrepareInput {
  return {
    db, requestId: 'r1', question: 'x', requester: OUTSIDE, requestedStep: 'answer', maxStep: 'answer', settings: SETTINGS, dataClass: 'own',
    allowedSources: ['gmail'], ...over,
  };
}

/** select picks `item`; verify says `answers`. */
function model(item: string, answer: string, answers = true) {
  hybrid = createFakeHybrid((spec) =>
    spec.purpose === 'verify-answer'
      ? { text: JSON.stringify({ answers, reason: answers ? 'The passage states it.' : 'A pickup date is not a vet visit.' }), source: 'on_device' }
      : { text: JSON.stringify({ item, answer }), source: 'on_device' },
  );
  setHybridForTests(hybrid);
}
const labels = (p: Proposal) => p.trace.map((s) => s.label);

beforeEach(() => {
  resetAiForTests();
  privacy.resetPrivacyMock();
  db = fakeDb();
  idx.resetIndexMock([GOOD_DOG, ZILLOW, ...RAMKI]);
  setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
  model('P1', 'x');
});

describe('the tester cases (Nov 20)', () => {
  it('T02: a pickup date is not a vet visit: the on-device check says no, so nothing is shared', async () => {
    idx.search.mockResolvedValue([idx.cand(GOOD_DOG.id)]);
    model('P1', "Bella's vet visit is on Jun 12.", false);
    const p = await prepareProposal(input({ question: "When is Bella's next vet visit?" }));
    expect(p.outcome).toBe('no-match');
    expect(hybrid.calls.map((c) => [c.spec.purpose, c.spec.mode])).toEqual([['select-answer', 'ONLY_ON_DEVICE'], ['verify-answer', 'ONLY_ON_DEVICE']]);
    const verify = promptText(hybrid.calls[1].parts);
    for (const part of ["Question: When is Bella's next vet visit?", "Proposed answer: Bella's vet visit is on Jun 12.", 'From: Good Dog Daycare <hello@gooddog.example>', 'Pickup Jun 12 at 5 PM']) {
      expect(verify).toContain(part);
    }
    expect(p.trace.find((s) => s.kind === 'answer')).toMatchObject({ label: 'The item does not answer the question', where: 'device', sdkReported: 'on_device' });
    expect(p.options.every((o) => !o.available && o.unavailableReason === UNAVAILABLE.noMatch)).toBe(true);
    expect(privacy.buildStepOption).not.toHaveBeenCalled();
  });

  it('T03, T04: "the latest" puts the newest first and, with a sender filter, gives the model only the newest few', async () => {
    const more = [20, 30, 40].map((ago, i) => record({ id: `gmail:ramki-old-${i}`, source: 'gmail', title: `Old ${i}`, from: 'Ramki <ramki@inbox.example>', category: 'Work', date: T - ago * DAY, text: 'An older note.' }));
    for (const r of more) idx.records.set(r.id, r);
    const list = [...more, ...RAMKI];
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Ramki' } });
      return list.map((r) => idx.cand(r.id));
    });
    model('P1', 'Ramki sent update number 2 on the release plan.');
    const p = await prepareProposal(input({ question: "What did Ramki's latest email say?" }));
    expect(p.outcome).toBe('ready');
    expect(p.item?.recordId).toBe('gmail:ramki-2');                  // 1 day ago
    const ids = hybrid.callsFor('select-answer')[0].meta?.recordIds;
    expect(ids).toEqual(['gmail:ramki-2', 'gmail:ramki-0', 'gmail:ramki-1', 'gmail:ramki-3', 'gmail:ramki-old-0']);   // newest 5 of 7
    expect(promptText(hybrid.callsFor('select-answer')[0].parts)).toContain('The passages are listed newest first.');
    expect(labels(p)).toContain('Put the matches newest first, because the question asks for the latest');
  });

  it('T04: without a filter, "the latest" keeps every match and only changes the order', async () => {
    idx.search.mockResolvedValue(RAMKI.map((r) => idx.cand(r.id)));
    const p = await prepareProposal(input({ question: 'What is the latest on the release plan?' }));
    expect(p.outcome).toBe('ready');
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:ramki-2', 'gmail:ramki-0', 'gmail:ramki-1', 'gmail:ramki-3']);
  });

  it('T05: a count is unsupported: no search, no model, and the line for the asker', async () => {
    const p = await prepareProposal(input({ question: 'How many Strava emails did I get this month?' }));
    expect(p.outcome).toBe('unsupported');
    expect(idx.search).not.toHaveBeenCalled();
    expect(hybrid.calls).toHaveLength(0);
    expect(p.options[0].unavailableReason).toBe("Sieve answers from one item at a time at this level, so counts aren't available.");
    expect(labels(p)).toEqual(['This asks for a count. Sieve answers from one item at a time, so nothing was searched.']);
  });

  it('T10: an item with a verification code is never shared, and no model reads it', async () => {
    idx.search.mockResolvedValue([idx.cand(ZILLOW.id)]);
    const p = await prepareProposal(input({ question: 'Show me my Google verification emails' }));
    expect(p.outcome).toBe('blocked-never');
    expect(p.rule).toBe('never');
    expect(p.item?.recordId).toBe(ZILLOW.id);
    expect(hybrid.calls).toHaveLength(0);
    expect(p.options[0].unavailableReason).toBe('Verification codes and sign-in links are never shared.');
    expect(labels(p)).toContain('1 item holds a verification code or a sign-in link, never shared, stopped before any model read it');
  });

  it('T10: next to an item that answers, the code item is left out before the model reads anything', async () => {
    idx.search.mockResolvedValue([idx.cand(ZILLOW.id), idx.cand(GOOD_DOG.id)]);
    model('P1', 'Bella is picked up on Jun 12 at 5 PM.');
    const p = await prepareProposal(input({ question: 'When do I pick up Bella?' }));
    expect(p.outcome).toBe('ready');
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual([GOOD_DOG.id]);
    expect(hybrid.calls.some((c) => promptText(c.parts).includes('733211'))).toBe(false);
  });

  it('a check that cannot run leaves the answer for the person, with a warning (no auto-approve)', async () => {
    idx.search.mockResolvedValue([idx.cand(GOOD_DOG.id)]);
    hybrid = createFakeHybrid((spec) =>
      spec.purpose === 'verify-answer' ? { text: 'not json', source: 'on_device' } : { text: JSON.stringify({ item: 'P1', answer: 'Pickup is Jun 12 at 5 PM.' }), source: 'on_device' },
    );
    setHybridForTests(hybrid);
    const p = await prepareProposal(input({ question: 'When do I pick up Bella?' }));
    expect(p.outcome).toBe('ready');
    expect(p.warnings.map((w) => w.kind)).toContain('unverified-answer');
    expect(p.trace.find((s) => s.kind === 'answer')?.label).toBe("Couldn't check the answer against the item on this device");
  });

  it('the in-app parsed `from`, `source` and dates are not passed to search as filters (search finds the cues itself)', async () => {
    idx.parseQuestion.mockImplementation((q) => ({ normalized: q, corrected: q, hints: { from: 'work', source: 'mail', after: '2026-11-01', terms: ['Q4'] } }));
    idx.search.mockResolvedValue([]);
    await prepareProposal(input({ question: 'emails from work', requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, maxStep: 'full' }));
    expect(idx.search.mock.calls[0][2]).toMatchObject({ hints: { terms: ['Q4'] } });
    expect((idx.search.mock.calls[0][2] as { hints: object }).hints).not.toHaveProperty('from');
    expect((idx.search.mock.calls[0][2] as { hints: object }).hints).not.toHaveProperty('source');
    expect((idx.search.mock.calls[0][2] as { hints: object }).hints).not.toHaveProperty('after');
  });
});
