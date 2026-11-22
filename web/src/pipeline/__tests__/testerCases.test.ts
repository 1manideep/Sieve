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

  it('"the latest" from a sender with nothing else asked: only the newest is read; with something asked about, the newest five (Nov 22)', async () => {
    const more = [20, 30, 40].map((ago, i) => record({ id: `gmail:ramki-old-${i}`, source: 'gmail', title: `Old ${i}`, from: 'Ramki <ramki@inbox.example>', category: 'Work', date: T - ago * DAY, text: 'An older note.' }));
    for (const r of more) idx.records.set(r.id, r);
    const list = [...more, ...RAMKI];
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Ramki' } });
      return list.map((r) => idx.cand(r.id));
    });
    model('P1', 'Ramki sent update number 2 on the release plan.');
    const p = await prepareProposal(input({ question: "What did Ramki's latest email say?" }));
    expect(p.item?.recordId).toBe('gmail:ramki-2');                  // 1 day ago
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:ramki-2']);
    expect(labels(p)).toContain('Read only the newest one, because that is the one the question asks about');
    // the question also asks about a thing: his newest email may not be about it, so the newest five are read
    await prepareProposal(input({ question: "What did Ramki's latest email say about the budget?" }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toHaveLength(5);
  });

  it('"the latest" about a named thing with no sender: only the newest email whose title holds it is read (Nov 22)', async () => {
    const klaro = (id: string, title: string, ago: number, text: string) => record({ id: `gmail:${id}`, source: 'gmail', title, from: 'Klaro <noreply@klaro.example>', category: 'Money', date: T - ago * DAY, text });
    const done = klaro('plan-done', 'We got your final Dashbite payment', 3, 'We received your final payment of $13.08. Your payment plan is now completed.');
    const updated = klaro('plan-updated', 'Updated payment plan for Dashbite', 3.1, 'Your payment plan was updated after a refund.');
    const failed = klaro('plan-failed', 'Payment failed for Dashbite', 1, 'Your payment to Dashbite failed because it could not be processed.');
    for (const r of [done, updated, failed]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([done, updated, failed].map((r) => idx.cand(r.id)));
    model('P1', 'The payment to Dashbite did not go through.');
    const p = await prepareProposal(input({ question: 'What did the most recent email about my Dashbite payment plan say?' }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:plan-failed']);
    expect(p.item?.recordId).toBe('gmail:plan-failed');
    expect(labels(p)).toContain('Read only the newest one, because that is the one the question asks about');
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
    const p = await prepareProposal(input({ question: "What did Ramki's latest email say about the release?" }));
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

  it('an exact number in the question: only the items that hold it are read (another booking by the same sender is not)', async () => {
    const mine = record({ id: 'gmail:bus-mine', source: 'gmail', title: 'Booking Confirmation #4471902288', from: 'Lakeline <noreply@lakeline.example>', category: 'Travel', date: T - 40 * DAY, text: 'Booking Number: 4471902288. Departure Station Fairview Bus Station, 06:40 AM.' });
    const proof = record({ id: 'gmail:bus-proof', source: 'gmail', title: 'Payment proof email', from: 'Lakeline <noreply@lakeline.example>', category: 'Travel', date: T - 40 * DAY, text: 'Thank you for your booking (#4471902288). Your payment proof is attached.' });
    const other = record({ id: 'gmail:bus-other', source: 'gmail', title: 'Booking Confirmation #4471907755', from: 'Lakeline <noreply@lakeline.example>', category: 'Travel', date: T - 3 * DAY, text: 'Booking Number: 4471907755. Departure Station Marlow Transit Center, 09:15 AM.' });
    for (const r of [mine, proof, other]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([other, mine, proof].map((r) => idx.cand(r.id)));
    model('P1', 'Booking 4471902288 departs from Fairview Bus Station.');
    // the number is read from the question itself: this asker sent no terms
    const p = await prepareProposal(input({ question: 'Where does Lakeline booking 4471902288 depart from?' }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:bus-mine', 'gmail:bus-proof']);
    expect(p.item?.recordId).toBe('gmail:bus-mine');
    expect(labels(p)).toContain('Read only the 2 items that hold the exact number in the question');
    // a number no candidate holds changes nothing
    const q = await prepareProposal(input({ question: 'Where does Lakeline booking 9900112233 depart from?' }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toEqual(['gmail:bus-other', 'gmail:bus-mine', 'gmail:bus-proof']);
    expect(labels(q).join(' ')).not.toContain('hold the exact number');
  });

  it('the status of an order named by its number: only its newest item is read, so a later cancellation answers, not the confirmation', async () => {
    const confirmed = record({ id: 'gmail:ord-confirmed', source: 'gmail', title: 'Your order US20418833 is confirmed', from: 'Peak Athletics <orders@peak.example>', category: 'Shopping', date: T - 2 * DAY, text: 'Order US20418833 was confirmed and is getting ready to ship.' });
    const cancelled = record({ id: 'gmail:ord-cancelled', source: 'gmail', title: 'Your order US20418833 has been cancelled', from: 'Peak Athletics <orders@peak.example>', category: 'Shopping', date: T - 2 * DAY + 3_600_000, text: 'Your order US20418833 has been cancelled as requested.' });
    const promo = record({ id: 'gmail:ord-promo', source: 'gmail', title: 'New arrivals', from: 'Peak Athletics <news@peak.example>', category: 'Shopping', date: T - DAY, text: 'Shop the winter range.' });
    for (const r of [confirmed, cancelled, promo]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([confirmed, promo, cancelled].map((r) => idx.cand(r.id)));
    model('P1', 'Your order US20418833 has been cancelled.');
    const p = await prepareProposal(input({ question: 'What is the status of Peak Athletics order US20418833?', hints: { terms: ['US20418833'] } }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:ord-cancelled']);
    expect(p.item?.recordId).toBe('gmail:ord-cancelled');
    expect(labels(p)).toContain('Read only the newest of those, because the newest says how it stands now');
    // a question about a fact of the order, not how it stands, keeps the search order
    await prepareProposal(input({ question: 'How much was Peak Athletics order US20418833?', hints: { terms: ['US20418833'] } }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toEqual(['gmail:ord-confirmed', 'gmail:ord-cancelled']);
  });

  it('of seven candidates the model reads the best five; the count and place in the reason code say so', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => record({ id: `gmail:note-${i}`, source: 'gmail', title: `Note ${i}`, from: 'Ramki <ramki@inbox.example>', category: 'Work', date: T - (i + 1) * DAY, text: `Note ${i} about the release plan.` }));
    for (const r of seven) idx.records.set(r.id, r);
    idx.search.mockResolvedValue(seven.map((r) => idx.cand(r.id)));
    model('P2', 'The release plan moved.', false);
    const p = await prepareProposal(input({ question: 'What happened to the release plan?' }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(seven.slice(0, 5).map((r) => r.id));
    // the second check said no: it ends there, the model is not asked for a second choice
    expect(hybrid.callsFor('select-answer')).toHaveLength(1);
    expect(p.outcome).toBe('no-match');
    expect(p.reasonCode).toMatch(/^second-check-no-r2of5-tx-gx-b1-c(?:[\w-]{1,4}\.){4}[\w-]{1,4}$/);
  });

  it('a "when" question answered with no date or number in it shares nothing', async () => {
    const breeder = record({ id: 'gmail:cover-breeder', source: 'gmail', title: 'Biscuit comes home Saturday', from: 'Dana Hill <dana@oakhill.example>', category: 'Personal', date: T - 25 * DAY, text: 'Pickup is Saturday at 11 AM. His free cover starts on arrival day, after you bring him home.' });
    idx.records.set(breeder.id, breeder);
    idx.search.mockResolvedValue([idx.cand(breeder.id)]);
    model('P1', "Your dog's free cover starts on arrival day, after you bring him home.");
    const p = await prepareProposal(input({ question: "When does my dog's free cover run out?" }));
    expect(p.outcome).toBe('no-match');
    expect(p.reasonCode).toMatch(/^answer-lacks-asked-kind-r1-c[\w-]{1,4}$/);
    expect(hybrid.callsFor('verify-answer')).toHaveLength(0);
    // with a date in it, the same answer goes on to the second check
    model('P1', 'His free cover runs out 30 days after pickup.');
    const q = await prepareProposal(input({ question: "When does my dog's free cover run out?" }));
    expect(q.outcome).toBe('ready');
  });

  it('a question that asks for a date reads only the items that hold one, when some do', async () => {
    const promo = record({ id: 'gmail:cover-promo', source: 'gmail', title: 'Keep Biscuit covered', from: 'Pawsure <news@pawsure.example>', category: 'Personal', date: T - 2 * DAY, text: 'Your free cover is ending soon. Continue so there is no gap.' });
    const welcome = record({ id: 'gmail:cover-welcome', source: 'gmail', title: 'Welcome to Pawsure', from: 'Pawsure <hello@pawsure.example>', category: 'Personal', date: T - 20 * DAY, text: 'Biscuit is covered until December 2, 2026.' });
    for (const r of [promo, welcome]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([promo, welcome].map((r) => idx.cand(r.id)));
    model('P1', 'The free cover runs out on December 2, 2026.');
    const p = await prepareProposal(input({ question: "When does my dog's free cover run out?" }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:cover-welcome']);
    expect(labels(p)).toContain('Left out 1 item with no amount or date in it, because the question asks for one');
    // a question that asks for neither reads both
    await prepareProposal(input({ question: 'What does Pawsure say about the free cover?' }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toEqual(['gmail:cover-promo', 'gmail:cover-welcome']);
  });

  it('other words for the search come from the on-device model, before the search, and never for an exact number (Nov 22)', async () => {
    idx.search.mockResolvedValue([idx.cand(GOOD_DOG.id)]);
    model('P1', 'Pickup is on Jun 12 at 5 PM.');
    hybrid.words = ['collection time', 'pick-up'];
    const p = await prepareProposal(input({ question: 'When do I fetch Bella from daycare?' }));
    expect(hybrid.wordCalls).toHaveLength(1);
    expect(hybrid.wordCalls[0].spec.mode).toBe('ONLY_ON_DEVICE');
    expect(promptText(hybrid.wordCalls[0].parts)).toBe('Question: When do I fetch Bella from daycare?');   // the question, and nothing of any item
    expect((idx.search.mock.calls[0][2] as { expand?: string[] }).expand).toEqual(['collection time', 'pick-up']);
    expect(labels(p)).toContain('Thought of 2 other words the item may use, and searched for them too');
    // no words back: the search runs as it is, and the trace has no row for it
    hybrid.words = [];
    const plain = await prepareProposal(input({ question: 'When do I fetch Bella from daycare?' }));
    expect((idx.search.mock.calls.at(-1)?.[2] as { expand?: string[] }).expand).toBeUndefined();
    expect(labels(plain).some((l) => l.includes('other word'))).toBe(false);
    // an exact number finds its item: the model is not asked
    hybrid.words = ['anything'];
    await prepareProposal(input({ question: 'Where does booking 3391976083 leave from?', hints: { terms: ['3391976083'] } }));
    expect(hybrid.wordCalls).toHaveLength(2);
  });

  it('with no on-device model the search runs with the question as it is: the question never goes to the cloud for other words (Nov 22)', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'unavailable', image: 'unavailable' } }));
    idx.search.mockResolvedValue([idx.cand(GOOD_DOG.id)]);
    hybrid.words = ['collection time'];
    await prepareProposal(input({ question: 'When do I fetch Bella from daycare?', dataClass: 'sample' }));
    expect(hybrid.wordCalls).toHaveLength(0);
    expect((idx.search.mock.calls[0][2] as { expand?: string[] }).expand).toBeUndefined();
  });

  it('a second check that says no names the pick without its content (place, exact terms, numbers)', async () => {
    idx.search.mockResolvedValue([GOOD_DOG, ...RAMKI.slice(0, 2)].map((r) => idx.cand(r.id)));
    model('P1', 'Bella has a vet visit on Jun 12 at 5 PM.', false);
    const p = await prepareProposal(input({ question: "When is Bella's vet visit?" }));
    expect(p.outcome).toBe('no-match');
    // the two notes hold no date, so only the booking was read; with nothing else to pick from, it ends there
    expect(p.reasonCode).toMatch(/^second-check-no-r1of1-tx-g1-b1-c[\w-]{1,4}$/);
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
