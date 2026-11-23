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
// the PDF of an email is read through Gmail: here a stand-in that has none unless a test gives one
const attachments = vi.hoisted(() => ({ text: new Map<string, string>() }));
vi.mock('../attachmentText', async (importOriginal) => {
  const real = await importOriginal<typeof import('../attachmentText')>();
  return {
    ...real,
    withAttachmentText: vi.fn(async (rec: { id: string; text?: string }) => {
      const extra = attachments.text.get(rec.id);
      return extra ? { ...rec, text: `${rec.text ?? ''}\n\nAttached file receipt.pdf: ${extra}` } : null;
    }),
  };
});

const SETTINGS: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
const OUTSIDE = { kind: 'outside' as const, grantId: 'g1', aiName: 'Claude' };
const DAY = 86_400_000;
const T = new Date(2026, 10, 18, 9, 0).getTime();
let db = fakeDb();
let hybrid: FakeHybrid;

const SUNNY_PAWS = record({
  id: 'gmail:sunnypaws', source: 'gmail', title: 'Bella: your booking is confirmed', from: 'Sunny Paws Daycare <hello@sunnypaws.example>', category: 'Personal', date: T - 5 * DAY,
  text: 'Booking confirmed for Bella. Drop-off Jun 10 at 8 AM. Pickup Jun 12 at 5 PM. Vaccines on file: rabies, valid to March 2027.',
});
const NESTRA = record({
  id: 'gmail:nestra', source: 'gmail', title: 'Your Nestra verification code', from: 'Nestra <no-reply@nestra.example>', category: 'Home', date: T - DAY,
  text: 'Your Nestra verification code is 733211. It expires in 10 minutes. If you did not ask for it, you can ignore this email.',
});
const BENJI = [3, 9, 1, 14].map((ago, i) =>
  record({
    id: `gmail:benji-${i}`, source: 'gmail', title: `Notes ${i}`, from: 'Benji <benji@inbox.example>', category: 'Work', date: T - ago * DAY,
    text: `Benji here. Update number ${i} on the release plan.`,
  }),
);

function input(over: Partial<PrepareInput> = {}): PrepareInput {
  return {
    db, requestId: 'r1', question: 'x', requester: OUTSIDE, requestedStep: 'answer', maxStep: 'answer', settings: SETTINGS, dataClass: 'own',
    allowedSources: ['gmail'], ...over,
  };
}

/** select picks `item`; verify says `answers`; a sentence given to a yes or no question is read as `yesNo`. */
function model(item: string, answer: string, answers = true, yesNo: 'yes' | 'no' | 'unclear' = 'unclear') {
  hybrid = createFakeHybrid((spec) =>
    spec.purpose === 'verify-answer'
      ? { text: JSON.stringify({ answers, reason: answers ? 'The passage states it.' : 'A pickup date is not a vet visit.' }), source: 'on_device' }
      : spec.purpose === 'yes-no'
        ? { text: JSON.stringify({ answer: yesNo }), source: 'on_device' }
        : { text: JSON.stringify({ item, answer }), source: 'on_device' },
  );
  setHybridForTests(hybrid);
}
const labels = (p: Proposal) => p.trace.map((s) => s.label);

beforeEach(() => {
  attachments.text.clear();
  resetAiForTests();
  privacy.resetPrivacyMock();
  db = fakeDb();
  idx.resetIndexMock([SUNNY_PAWS, NESTRA, ...BENJI]);
  setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
  model('P1', 'x');
});

describe('the tester cases (Nov 20)', () => {
  it('T02: a pickup date is not a vet visit: the on-device check says no, so nothing is shared', async () => {
    idx.search.mockResolvedValue([idx.cand(SUNNY_PAWS.id)]);
    model('P1', "Bella's vet visit is on Jun 12.", false);
    const p = await prepareProposal(input({ question: "When is Bella's next vet visit?" }));
    expect(p.outcome).toBe('no-match');
    expect(hybrid.calls.map((c) => [c.spec.purpose, c.spec.mode])).toEqual([['select-answer', 'ONLY_ON_DEVICE'], ['verify-answer', 'ONLY_ON_DEVICE']]);
    const verify = promptText(hybrid.calls[1].parts);
    for (const part of ["Question: When is Bella's next vet visit?", "Proposed answer: Bella's vet visit is on Jun 12.", 'From: Sunny Paws Daycare <hello@sunnypaws.example>', 'Pickup Jun 12 at 5 PM']) {
      expect(verify).toContain(part);
    }
    expect(p.trace.find((s) => s.kind === 'answer')).toMatchObject({ label: 'The item does not answer the question', where: 'device', sdkReported: 'on_device' });
    expect(p.options.every((o) => !o.available && o.unavailableReason === UNAVAILABLE.noMatch)).toBe(true);
    expect(privacy.buildStepOption).not.toHaveBeenCalled();
  });

  it('"the latest" from a sender with nothing else asked: only the newest is read; with something asked about, the newest five (Nov 22)', async () => {
    const more = [20, 30, 40].map((ago, i) =>
      record({ id: `gmail:benji-old-${i}`, source: 'gmail', title: ['Draft', 'Numbers', 'Follow-up'][i]!, from: 'Benji <benji@inbox.example>', category: 'Work', date: T - ago * DAY, text: 'An older note on the budget.' }),
    );
    for (const r of more) idx.records.set(r.id, r);
    const list = [...more, ...BENJI];
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Benji' } });
      return list.map((r) => idx.cand(r.id));
    });
    model('P1', 'Benji sent update number 2 on the release plan.');
    const p = await prepareProposal(input({ question: "What did Benji's latest email say?" }));
    expect(p.item?.recordId).toBe('gmail:benji-2');                  // 1 day ago
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:benji-2']);
    expect(labels(p)).toContain('Read only the newest one, because that is the one the question asks about');
    // the sender's newest is certain: the second check is not asked, even when it would say no (Nov 23, R29)
    expect(hybrid.callsFor('verify-answer')).toHaveLength(0);
    expect(labels(p)).toContain('Not checked again: this is the newest email from the sender you named');
    model('P1', 'Benji sent update number 2 on the release plan.', false);
    expect((await prepareProposal(input({ question: "What did Benji's latest email say?" }))).outcome).toBe('ready');
    // the question also asks about a thing: only his emails that hold it are read, newest first, and the second
    // check is asked, as before (Nov 23, R33)
    const budget = await prepareProposal(input({ question: "What did Benji's latest email say about the budget?" }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toEqual(['gmail:benji-old-0', 'gmail:benji-old-1', 'gmail:benji-old-2']);
    expect(labels(budget)).toContain('Left out 4 emails from that sender that say nothing about what the question names');
    expect(hybrid.callsFor('verify-answer')).toHaveLength(1);
  });

  it('a named sender and a thing none of their emails is about: no model reads any of them (Nov 23, R33)', async () => {
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Benji' } });
      return BENJI.map((r) => idx.cand(r.id));
    });
    model('P1', 'Benji said to disregard his last note.');
    const p = await prepareProposal(input({ question: 'What did Benji reply about the window subscription?' }));
    expect(p.outcome).toBe('no-match');
    expect(p.reasonCode).toBe('topic-not-in-sender-mail');
    expect(hybrid.callsFor('select-answer')).toHaveLength(0);
    expect(labels(p)).toContain("None of that sender's emails says anything about what the question names, so nothing is shared");
    // a word that is there in another form counts ("subscribed" for "subscription"), and nothing after "about" is no thing
    const subscribed = record({ id: 'gmail:benji-sub', source: 'gmail', title: 'Re: tools', from: 'Benji <benji@inbox.example>', category: 'Work', date: T - 2 * DAY, text: 'I subscribed the team to the window plan.' });
    idx.records.set(subscribed.id, subscribed);
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Benji' } });
      return [...BENJI, subscribed].map((r) => idx.cand(r.id));
    });
    model('P1', 'Benji subscribed the team to the window plan.');
    const found = await prepareProposal(input({ question: 'What did Benji reply about the window subscription?' }));
    expect(found.outcome).toBe('ready');
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual([subscribed.id]);
    model('P1', 'Benji sent update number 2 on the release plan.');
    await prepareProposal(input({ question: 'What did Benji ask me about?' }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toHaveLength(5);
  });

  it('"his latest email": the sender\'s own email, not another service\'s notice about him, and a notice is checked (Nov 23, R29)', async () => {
    const own = record({ id: 'gmail:teodor-own', source: 'gmail', title: 'Call notes', from: 'Teodor Marsh <teodor@mail.example>', category: 'Work', date: T - 90 * DAY, text: 'Can we move our call to Thursday at 4?' });
    const notice = record({ id: 'gmail:teodor-li', source: 'gmail', title: 'Teodor just messaged you', from: 'Teodor Marsh via LinkedIn <messages-noreply@linkedin.example>', category: 'Work', date: T - 2 * DAY, text: 'You have 1 new message. View message.' });
    for (const r of [own, notice]) idx.records.set(r.id, r);
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Teodor' } });
      return [notice, own].map((r) => idx.cand(r.id));
    });
    model('P1', 'Teodor asked to move your call to Thursday at 4.');
    const p = await prepareProposal(input({ question: 'What did Teodor ask me in his latest email?' }));
    expect(p.item?.recordId).toBe(own.id);
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual([own.id]);
    expect(labels(p)).toContain("Put the sender's own emails before notices about them from other services");
    expect(hybrid.callsFor('verify-answer')).toHaveLength(0);
    // asked for his LinkedIn message, the notice is first, and it is checked: it is not his own email
    model('P1', 'Teodor sent you a message.', false);
    const li = await prepareProposal(input({ question: 'What did Teodor ask me in his latest LinkedIn message?' }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds?.[0]).toBe(notice.id);
    expect(hybrid.callsFor('verify-answer')).toHaveLength(1);
    expect(li.outcome).toBe('no-match');
  });

  it('"the latest" about a named thing with no sender: only the newest email whose title holds it is read (Nov 22)', async () => {
    const clubdesk = (id: string, title: string, ago: number, text: string) => record({ id: `gmail:${id}`, source: 'gmail', title, from: 'Clubdesk <noreply@clubdesk.example>', category: 'Money', date: T - ago * DAY, text });
    const done = clubdesk('club-done', 'Last Lumora payment received', 3, 'We received your last payment of $21.40. Your membership is paid up.');
    const updated = clubdesk('club-updated', 'Your Lumora membership was changed', 3.1, 'Your membership payment was updated after a refund.');
    const failed = clubdesk('club-failed', 'Lumora payment did not go through', 1, 'Your payment to Lumora failed because it could not be processed.');
    for (const r of [done, updated, failed]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([done, updated, failed].map((r) => idx.cand(r.id)));
    model('P1', 'The payment to Lumora did not go through.');
    const p = await prepareProposal(input({ question: 'What did the most recent email about my Lumora membership payment say?' }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:club-failed']);
    expect(p.item?.recordId).toBe('gmail:club-failed');
    expect(labels(p)).toContain('Read only the newest one, because that is the one the question asks about');
  });

  it('T03, T04: "the latest" puts the newest first and, with a sender filter, gives the model only the newest few', async () => {
    const more = [20, 30, 40].map((ago, i) => record({ id: `gmail:benji-old-${i}`, source: 'gmail', title: `Old ${i}`, from: 'Benji <benji@inbox.example>', category: 'Work', date: T - ago * DAY, text: 'An older note on the release.' }));
    for (const r of more) idx.records.set(r.id, r);
    const list = [...more, ...BENJI];
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Benji' } });
      return list.map((r) => idx.cand(r.id));
    });
    model('P1', 'Benji sent update number 2 on the release plan.');
    const p = await prepareProposal(input({ question: "What did Benji's latest email say about the release?" }));
    expect(p.outcome).toBe('ready');
    expect(p.item?.recordId).toBe('gmail:benji-2');                  // 1 day ago
    const ids = hybrid.callsFor('select-answer')[0].meta?.recordIds;
    expect(ids).toEqual(['gmail:benji-2', 'gmail:benji-0', 'gmail:benji-1', 'gmail:benji-3', 'gmail:benji-old-0']);   // newest 5 of 7
    expect(promptText(hybrid.callsFor('select-answer')[0].parts)).toContain('The passages are listed newest first.');
    expect(labels(p)).toContain('Put the matches newest first, because the question asks for the latest');
  });

  it('T04: without a filter, "the latest" keeps every match and only changes the order', async () => {
    idx.search.mockResolvedValue(BENJI.map((r) => idx.cand(r.id)));
    const p = await prepareProposal(input({ question: 'What is the latest on the release plan?' }));
    expect(p.outcome).toBe('ready');
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:benji-2', 'gmail:benji-0', 'gmail:benji-1', 'gmail:benji-3']);
  });

  it('an exact number in the question: only the items that hold it are read (another booking by the same sender is not)', async () => {
    const mine = record({ id: 'gmail:bus-mine', source: 'gmail', title: 'Booking Confirmation #4471902288', from: 'Lakeline <noreply@lakeline.example>', category: 'Travel', date: T - 40 * DAY, text: 'Booking Number: 4471902288. Departure Station Fairview Bus Station, 07:15 AM.' });
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
    const seven = Array.from({ length: 7 }, (_, i) => record({ id: `gmail:note-${i}`, source: 'gmail', title: `Note ${i}`, from: 'Benji <benji@inbox.example>', category: 'Work', date: T - (i + 1) * DAY, text: `Note ${i} about the release plan.` }));
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

  it('the second check reads the answer with its day written out (Nov 22, B11)', async () => {
    const event = record({ id: 'gmail:cocoa-day', source: 'gmail', title: 'Hot cocoa in the clubhouse today', from: 'Birchwood Residents <office@birchwood.example>', category: 'Personal', date: new Date(2026, 10, 6, 9).getTime(), text: 'Come warm up with us at the clubhouse. Today from 10:30 AM to 12:00 PM. Stop by for a cup of hot cocoa.' });
    idx.records.set(event.id, event);
    idx.search.mockResolvedValue([idx.cand(event.id)]);
    model('P1', 'The get-together is today from 10:30 AM to 12:00 PM.');
    const p = await prepareProposal(input({ question: 'When is the hot cocoa get-together at the clubhouse?', now: new Date(2026, 10, 22, 12).getTime() }));
    expect(p.outcome).toBe('ready');
    const check = promptText(hybrid.callsFor('verify-answer')[0].parts);
    expect(check).toContain('Proposed answer: The get-together is on November 6, 2026 from 10:30 AM to 12:00 PM.');
    expect(check).not.toContain('is today from');
    expect(p.options[0].text).toContain('on November 6, 2026 from 10:30 AM');
  });

  it('an answer that repeats the amount of the prompt\'s own example shares nothing', async () => {
    const order = record({ id: 'gmail:order-lumora', source: 'gmail', title: 'Your Lumora order', from: 'Lumora <no-reply@mail.lumora.example>', category: 'Shopping', date: T - 12 * DAY, text: 'Thanks for your order. We charged $18.40 to the card ending 4417. Your items arrive in 3 to 5 days.' });
    idx.records.set(order.id, order);
    idx.search.mockResolvedValue([idx.cand(order.id)]);
    // the same on both tries: the item holds no "$1,200", so the model took it from its instructions
    model('P1', 'You were charged $1,200.');
    const p = await prepareProposal(input({ question: 'How much did Lumora charge me?' }));
    expect(hybrid.callsFor('select-answer')).toHaveLength(2);
    expect(p.outcome).toBe('no-match');
    expect(p.reasonCode).toMatch(/^answer-repeats-prompt-example-r1-c[\w-]{1,4}$/);
    expect(hybrid.callsFor('verify-answer')).toHaveLength(0);
    // with the item's own amount, the same item answers
    model('P1', 'You were charged $18.40.');
    expect((await prepareProposal(input({ question: 'How much did Lumora charge me?' }))).outcome).toBe('ready');
  });

  it('a long number the asker gave, written a digit off in the answer, is written back (Nov 22, B05)', async () => {
    const status = record({ id: 'gmail:job-status', source: 'gmail', title: 'Your application: AI Research Associate', from: 'Lumora Talent <talent@careers.lumora.example>', category: 'Work', date: T - 30 * DAY, text: 'Thank you for applying to job 310774205. We are sorry to let you know that we are moving forward with other candidates.' });
    idx.records.set(status.id, status);
    idx.search.mockResolvedValue([idx.cand(status.id)]);
    model('P1', 'Your application for job number 31077205 was not selected.');
    const p = await prepareProposal(input({ question: 'What is the status of my application for job number 310774205?', hints: { terms: ['310774205'] }, requester: OUTSIDE }));
    expect(p.outcome).toBe('ready');
    expect(p.options[0].text).toContain('310774205');
    expect(p.options[0].text).not.toContain('31077205');
    // the only item that holds the asked number: the second check is not asked (Nov 23, B05)
    expect(hybrid.callsFor('verify-answer')).toHaveLength(0);
    expect(labels(p)).toContain('Not checked again: this is the only item that holds the number you gave');
  });

  it('the second check is still asked when another candidate holds the asked number too', async () => {
    const a = record({ id: 'gmail:job-a', source: 'gmail', title: 'Your application 310774205', from: 'Lumora Talent <talent@careers.lumora.example>', category: 'Work', date: T - 30 * DAY, text: 'Thank you for applying to job 310774205.' });
    const b = record({ id: 'gmail:job-b', source: 'gmail', title: 'Update on job 310774205', from: 'Lumora Talent <talent@careers.lumora.example>', category: 'Work', date: T - 20 * DAY, text: 'We are moving forward with other candidates for job 310774205.' });
    for (const r of [a, b]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([idx.cand(b.id), idx.cand(a.id)]);
    model('P1', 'You were not selected for job 310774205.');
    await prepareProposal(input({ question: 'What is the status of my application for job number 310774205?', hints: { terms: ['310774205'] }, requester: OUTSIDE }));
    expect(hybrid.callsFor('verify-answer')).toHaveLength(1);
    // a short term says too little to settle it
    idx.search.mockResolvedValue([idx.cand(a.id)]);
    await prepareProposal(input({ question: 'What did the email about job 4471 say?', hints: { terms: ['4471'] }, requester: OUTSIDE }));
    expect(hybrid.callsFor('verify-answer')).toHaveLength(2);   // asked again for this one too
  });

  it('a number that stands only in the subject line, or that the asker typed, is not marked as unverified', async () => {
    const status = record({ id: 'gmail:job-subject', source: 'gmail', title: 'Your job application status (Job number: 310774205)', from: 'Lumora Talent <talent@careers.lumora.example>', category: 'Work', date: T - 30 * DAY, text: 'Thank you for applying. We are sorry to let you know that we are moving forward with other candidates.' });
    idx.records.set(status.id, status);
    idx.search.mockResolvedValue([idx.cand(status.id)]);
    model('P1', 'Your application for job number 310774205 was not selected.');
    const p = await prepareProposal(input({ question: 'What is the status of my application for job number 310774205?', hints: { terms: ['310774205'] } }));
    expect(p.outcome).toBe('ready');
    expect(p.warnings.some((w) => /310774205/.test(w.message))).toBe(false);
    // a number that is nowhere (not the item, its subject or the question) still is
    model('P1', 'Your application for job number 310774205 was not selected on 4471 grounds.');
    const q = await prepareProposal(input({ question: 'What is the status of my application for job number 310774205?', hints: { terms: ['310774205'] } }));
    expect(q.warnings.some((w) => /4471/.test(w.message))).toBe(true);
  });

  it('a yes or no question answered with a sentence is read as yes or no by one small call (Nov 22, R13)', async () => {
    const bins = record({ id: 'gmail:bins', source: 'gmail', title: 'Update on the new bike room', from: 'Birchwood Residents <office@birchwood.example>', category: 'Home', date: T - 20 * DAY, text: 'Hello residents, the new bike room is not ready for use yet. We are waiting for the racks to be delivered. Please keep using the old room.' });
    idx.records.set(bins.id, bins);
    idx.search.mockResolvedValue([idx.cand(bins.id)]);
    model('P1', 'The new bike room is not ready for use yet.', true, 'no');
    const p = await prepareProposal(input({ question: 'Can I start using the new bike room at my building yet?' }));
    expect(p.outcome).toBe('ready');
    // one answer call (no second try), one reading call that gets the question and the sentence and nothing of the item
    expect(hybrid.callsFor('select-answer')).toHaveLength(1);
    const reading = hybrid.callsFor('yes-no');
    expect(reading).toHaveLength(1);
    expect(promptText(reading[0].parts)).toBe('Question: Can I start using the new bike room at my building yet?\nSentence: The new bike room is not ready for use yet.');
    // the second check and the answer both carry the plain "No."
    expect(promptText(hybrid.callsFor('verify-answer')[0].parts)).toContain('Proposed answer: No.');
    expect(p.options[0].text).toBe('No.');
    expect(labels(p)).toContain('The answer was a sentence; read as "No."');

    // already yes or no: no reading call
    model('P1', 'No.', true, 'yes');
    const plain = await prepareProposal(input({ question: 'Can I start using the new bike room at my building yet?' }));
    expect(hybrid.callsFor('yes-no')).toHaveLength(0);
    expect(plain.options[0].text).toBe('No.');

    // a sentence that does not settle it stays a sentence (the share-time check then withholds it, as before)
    model('P1', 'The racks for the new bike room are on order.', true, 'unclear');
    const open = await prepareProposal(input({ question: 'Can I start using the new bike room at my building yet?' }));
    expect(hybrid.callsFor('yes-no')).toHaveLength(1);
    expect(labels(open)).toContain('The answer was a sentence that does not say yes or no');
    expect(promptText(hybrid.callsFor('verify-answer')[0].parts)).toContain('Proposed answer: The racks for the new bike room are on order.');
  });

  it('a never-shared item explains an empty result only when it ranked ahead of what a model may read (Nov 23)', async () => {
    const statement = record({ id: 'gmail:statement', source: 'gmail', title: 'Your November statement is ready', from: 'Kestrelmoor Bank <statements@kestrelmoor.example>', category: 'Money', date: T - 15 * DAY, text: 'Your statement is ready to view. Sign in to online banking to see it.' });
    const clinic = record({ id: 'gmail:clinic', source: 'gmail', title: 'Appointment reminder: Dr. Okafor, Tue 9:30 AM', from: 'Maple Clinic <hello@mapleclinic.example>', category: 'Health', date: T - 3 * DAY, text: 'This is a reminder of your appointment on Tuesday at 9:30 AM.' });
    idx.records.set(statement.id, statement);
    idx.records.set(clinic.id, clinic);
    model('none', '');
    // the item a model may read ranked first and gave no answer: nothing matched, and the clinic email is not named
    idx.search.mockResolvedValue([idx.cand(statement.id), idx.cand(clinic.id)]);
    const below = await prepareProposal(input({ question: 'What is my latest bank balance?' }));
    expect(below.outcome).toBe('no-match');
    expect(below.item).toBeUndefined();
    expect(below.reasonCode).toMatch(/^model-picked-none-of1/);
    // the never-shared item ranked first: it is the likely answer, so the result says a rule held it
    idx.search.mockResolvedValue([idx.cand(clinic.id), idx.cand(statement.id)]);
    const ahead = await prepareProposal(input({ question: 'When is my appointment?' }));
    expect(ahead.outcome).toBe('blocked-never');
    expect(ahead.item?.recordId).toBe(clinic.id);
    // only never-shared items were found: held, as before
    idx.search.mockResolvedValue([idx.cand(clinic.id)]);
    expect((await prepareProposal(input({ question: 'When is my appointment?' }))).outcome).toBe('blocked-never');
    // in every case no model call carried the clinic email
    expect(hybrid.calls.every((c) => !(c.meta?.recordIds ?? []).includes(clinic.id))).toBe(true);
  });

  it('a receipt that is only in the PDF attachment is read with the email, for this answer only (Nov 23, B02)', async () => {
    const plain = record({ id: 'gmail:sub-active', source: 'gmail', title: 'Thank you for purchasing Premium', from: 'Lumora <billing@lumora.example>', category: 'Money', date: T - 3 * DAY, text: 'Your subscription is now active and your receipt is attached.' });
    const other = record({ id: 'gmail:other-bill', source: 'gmail', title: 'Your bill', from: 'Kestrel Power <bills@kestrel.example>', category: 'Home', date: T - 5 * DAY, text: 'Your bill of $61.20 is due on the 12th.' });
    for (const r of [plain, other]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([idx.cand(plain.id), idx.cand(other.id)]);
    attachments.text.set(plain.id, 'Invoice 1093. Premium, 1 month. Total: $39.99. Paid by card.');
    model('P1', 'You paid $39.99 for Premium.');
    const p = await prepareProposal(input({ question: 'How much did I pay for Lumora Premium?' }));
    expect(p.outcome).toBe('ready');
    expect(labels(p)).toContain('Read the text of the PDF attached to 1 email, because the email itself holds no amount or date');
    // the model read the attachment's text with the email, and the email was not left out for lacking an amount
    const prompt = promptText(hybrid.callsFor('select-answer')[0].parts);
    expect(prompt).toContain('Total: $39.99');
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toContain(plain.id);
    // nothing is written back: the index keeps the email as it was
    expect(idx.records.get(plain.id)?.text).toBe('Your subscription is now active and your receipt is attached.');

    // an email that names no attachment, or a question that asks for no amount or date: no attachment is read
    const { withAttachmentText } = await import('../attachmentText');
    const calls = vi.mocked(withAttachmentText).mock.calls.length;
    await prepareProposal(input({ question: 'What did Lumora say about my Premium subscription?' }));
    expect(vi.mocked(withAttachmentText).mock.calls.length).toBe(calls);
  });

  it('a "when" question answered with no date or number in it shares nothing', async () => {
    const shop = record({ id: 'gmail:plan-shop', source: 'gmail', title: 'Your bike is ready Saturday', from: 'Dana Hill <dana@oakhillcycles.example>', category: 'Personal', date: T - 25 * DAY, text: 'Pickup is Saturday at 11 AM. The free service plan starts on pickup day, after you take it home.' });
    idx.records.set(shop.id, shop);
    idx.search.mockResolvedValue([idx.cand(shop.id)]);
    model('P1', 'The free service plan starts on pickup day, after you take it home.');
    const p = await prepareProposal(input({ question: 'When does the free service plan for my bike run out?' }));
    expect(p.outcome).toBe('no-match');
    expect(p.reasonCode).toMatch(/^answer-lacks-asked-kind-r1-c[\w-]{1,4}$/);
    expect(hybrid.callsFor('verify-answer')).toHaveLength(0);
    // with a date in it, the same answer goes on to the second check
    model('P1', 'The free service plan runs out 30 days after pickup.');
    const q = await prepareProposal(input({ question: 'When does the free service plan for my bike run out?' }));
    expect(q.outcome).toBe('ready');
  });

  it('a question that asks for a date reads only the items that hold one, when some do', async () => {
    const promo = record({ id: 'gmail:plan-promo', source: 'gmail', title: 'Keep your bike serviced', from: 'Spokeworks <news@spokeworks.example>', category: 'Personal', date: T - 2 * DAY, text: 'Your free service plan is ending soon. Continue so there is no gap.' });
    const welcome = record({ id: 'gmail:plan-welcome', source: 'gmail', title: 'Welcome to Spokeworks', from: 'Spokeworks <hello@spokeworks.example>', category: 'Personal', date: T - 20 * DAY, text: 'Your bike is covered until April 18, 2027.' });
    for (const r of [promo, welcome]) idx.records.set(r.id, r);
    idx.search.mockResolvedValue([promo, welcome].map((r) => idx.cand(r.id)));
    model('P1', 'The free service plan runs out on April 18, 2027.');
    const p = await prepareProposal(input({ question: 'When does the free service plan for my bike run out?' }));
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:plan-welcome']);
    expect(labels(p)).toContain('Left out 1 item with no amount or date in it, because the question asks for one');
    // a question that asks for neither reads both
    await prepareProposal(input({ question: 'What does Spokeworks say about the free service plan?' }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toEqual(['gmail:plan-promo', 'gmail:plan-welcome']);
  });

  it('other words for the search come from the on-device model, before the search, and never for an exact number (Nov 22)', async () => {
    idx.search.mockResolvedValue([idx.cand(SUNNY_PAWS.id)]);
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
    await prepareProposal(input({ question: 'Where does booking 4471906235 leave from?', hints: { terms: ['4471906235'] } }));
    expect(hybrid.wordCalls).toHaveLength(2);
    // the asker's days already narrow the search: not asked either
    await prepareProposal(input({ question: 'What did Sunny Paws say on June 10?', hints: { after: '2026-06-10', before: '2026-06-10' } }));
    expect(hybrid.wordCalls).toHaveLength(2);
  });

  it('with no on-device model the search runs with the question as it is: the question never goes to the cloud for other words (Nov 22)', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'unavailable', image: 'unavailable' } }));
    idx.search.mockResolvedValue([idx.cand(SUNNY_PAWS.id)]);
    hybrid.words = ['collection time'];
    await prepareProposal(input({ question: 'When do I fetch Bella from daycare?', dataClass: 'sample' }));
    expect(hybrid.wordCalls).toHaveLength(0);
    expect((idx.search.mock.calls[0][2] as { expand?: string[] }).expand).toBeUndefined();
  });

  it('a named sender and what was said on a day: their emails of that day are read, not one that only mentions the day (Nov 22)', async () => {
    const at = (m: number, d: number) => new Date(2026, m - 1, d, 10, 0).getTime();
    const from = 'Northside Gym <hello@northsidegym.example>';
    const lesson = record({ id: 'gmail:ng-class', source: 'gmail', title: 'Reminder: your class is tomorrow', from, category: 'Personal', date: at(3, 3), text: 'Your spin class is tomorrow at 7 AM. Bring a towel.' });
    const lockers = record({ id: 'gmail:ng-lockers', source: 'gmail', title: 'New lockers in the changing room', from, category: 'Personal', date: at(3, 3), text: 'We fitted new lockers this week.' });
    const renew = record({ id: 'gmail:ng-renew', source: 'gmail', title: 'Happy holidays and a reminder to renew', from, category: 'Personal', date: at(2, 27), text: 'Your membership renews on March 1. Classes start again on March 3.', mentionedDays: ['2026-03-01', '2026-03-03'] });
    for (const r of [lesson, lockers, renew]) idx.records.set(r.id, r);
    const found = [renew, lesson, lockers].map((r) => idx.cand(r.id));
    const days = { after: '2026-03-03', before: '2026-03-03' };
    const withFilters = (filters: object) => idx.search.mockImplementation(async (_db, _q, opts) => {
      (opts as { onReport?: (r: object) => void }).onReport?.({ filters });
      return found;
    });
    withFilters({ sender: 'Northside Gym', ...days });
    model('P1', 'Your spin class is tomorrow at 7 AM.');
    const p = await prepareProposal(input({ question: 'What did Northside Gym remind me about on March 3?', hints: { from: 'Northside Gym', ...days } }));
    // of the two sent that day, the one whose subject says it is a reminder is the one read
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual(['gmail:ng-class']);
    expect(labels(p)).toContain('Left out 1 email that only mentions those days, because the question asks what was said then');
    expect(labels(p)).toContain("Left out 1 email of those days, because another one's subject says it is what the question asks about");
    // a question that names no kind of message reads both
    await prepareProposal(input({ question: 'What did Northside Gym say on March 3?', hints: { from: 'Northside Gym', ...days } }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toEqual(['gmail:ng-class', 'gmail:ng-lockers']);
    // with no sender filter the emails of that day are from anyone: all three are read, as before
    withFilters(days);
    await prepareProposal(input({ question: 'What did Northside Gym remind me about on March 3?', hints: days }));
    expect(hybrid.callsFor('select-answer').at(-1)?.meta?.recordIds).toHaveLength(3);
  });

  it('days and a described sender, with nothing else to go by: unsupported before any search, whatever the index holds (Nov 22)', async () => {
    const days = { after: '2026-03-03', before: '2026-03-03' };
    const p = await prepareProposal(input({ question: 'What did my gym remind me about on March 3?', hints: days }));
    expect(p.outcome).toBe('unsupported');
    expect(p.reasonCode).toBe('sender-described-not-named');
    expect(p.options[0]?.unavailableReason).toBe("Sieve could not tell who that is from. Ask again with the sender's name.");
    expect(idx.search).not.toHaveBeenCalled();
    expect(hybrid.calls).toHaveLength(0);
    expect(hybrid.wordCalls).toHaveLength(0);
    // with the sender named by the asker, the same question is searched
    idx.search.mockResolvedValue([idx.cand(SUNNY_PAWS.id)]);
    await prepareProposal(input({ question: 'What did my gym remind me about on March 3?', hints: { ...days, from: 'Northside Gym' } }));
    expect(idx.search).toHaveBeenCalledTimes(1);
  });

  it('"the latest" from mail that cannot be checked with Gmail right now: an error that says so, not an old answer (Nov 22)', async () => {
    idx.search.mockImplementation(async (_db, _q, o) => {
      (o as { onReport?: (r: unknown) => void }).onReport?.({ filters: { sender: 'Benji' } });
      return BENJI.map((r) => idx.cand(r.id));
    });
    idx.verifyFresh.mockResolvedValue('unknown');
    model('P1', 'Benji sent update number 2 on the release plan.');
    const p = await prepareProposal(input({ question: "What did Benji's latest email say?" }));
    expect(p.outcome).toBe('error');
    expect(p.errorCode).toBe('mail-not-current');
    expect(labels(p).at(-1)).toBe("Couldn't check Gmail for newer mail, so nothing was prepared. Use Continue on the Gmail notice, then ask again.");
    // a question that does not ask for the latest is still answered from the copy here, with its warning
    const other = await prepareProposal(input({ question: 'What did Benji say about the release plan?' }));
    expect(other.outcome).toBe('ready');
  });

  it('a second check that says no names the pick without its content (place, exact terms, numbers)', async () => {
    idx.search.mockResolvedValue([SUNNY_PAWS, ...BENJI.slice(0, 2)].map((r) => idx.cand(r.id)));
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
    idx.search.mockResolvedValue([idx.cand(NESTRA.id)]);
    const p = await prepareProposal(input({ question: 'Show me my Google verification emails' }));
    expect(p.outcome).toBe('blocked-never');
    expect(p.rule).toBe('never');
    expect(p.item?.recordId).toBe(NESTRA.id);
    expect(hybrid.calls).toHaveLength(0);
    expect(p.options[0].unavailableReason).toBe('Verification codes and sign-in links are never shared.');
    expect(labels(p)).toContain('1 item holds a verification code or a sign-in link, never shared, stopped before any model read it');
  });

  it('T10: next to an item that answers, the code item is left out before the model reads anything', async () => {
    idx.search.mockResolvedValue([idx.cand(NESTRA.id), idx.cand(SUNNY_PAWS.id)]);
    model('P1', 'Bella is picked up on Jun 12 at 5 PM.');
    const p = await prepareProposal(input({ question: 'When do I pick up Bella?' }));
    expect(p.outcome).toBe('ready');
    expect(hybrid.callsFor('select-answer')[0].meta?.recordIds).toEqual([SUNNY_PAWS.id]);
    expect(hybrid.calls.some((c) => promptText(c.parts).includes('733211'))).toBe(false);
  });

  it('a question that asks for a verification code: no model reads anything, and the held code item is named (Nov 23, R37)', async () => {
    idx.search.mockResolvedValue([idx.cand(NESTRA.id), idx.cand(SUNNY_PAWS.id)]);
    model('P1', 'Your booking for Bella is confirmed.');
    const p = await prepareProposal(input({ question: 'What is the code in my latest Nestra verification email?' }));
    expect(p.outcome).toBe('blocked-never');
    expect(p.item?.recordId).toBe(NESTRA.id);
    expect(p.reasonCode).toBe('asks-one-time-code');
    expect(p.options[0].unavailableReason).toBe('Verification codes and sign-in links are never shared.');
    expect(hybrid.callsFor('select-answer')).toHaveLength(0);
    // with no code item among the matches, nothing matched, and still no model reads the rest
    idx.search.mockResolvedValue([idx.cand(SUNNY_PAWS.id)]);
    const none = await prepareProposal(input({ question: 'What is my Google sign-in code?' }));
    expect(none.outcome).toBe('no-match');
    expect(hybrid.callsFor('select-answer')).toHaveLength(0);
    // a booking or promo code is not one
    model('P1', 'Your booking for Bella is confirmed.');
    expect((await prepareProposal(input({ question: 'What is the booking code for Bella at Sunny Paws?' }))).outcome).toBe('ready');
  });

  it('an answer step that runs past its time is asked once more, and a second timeout is an error (Nov 23, R17)', async () => {
    idx.search.mockResolvedValue([idx.cand(SUNNY_PAWS.id)]);
    let selects = 0;
    const timesOut = (times: number) => {
      selects = 0;
      hybrid = createFakeHybrid((spec) => {
        if (spec.purpose === 'select-answer') {
          selects += 1;
          if (selects <= times) throw new DOMException('Timeout', 'TimeoutError');
          return { text: JSON.stringify({ item: 'P1', answer: 'Pickup is Jun 12 at 5 PM.' }), source: 'on_device' };
        }
        return { text: JSON.stringify({ answers: true, reason: 'It says so.' }), source: 'on_device' };
      });
      setHybridForTests(hybrid);
    };
    timesOut(1);
    const p = await prepareProposal(input({ question: 'When do I pick up Bella?' }));
    expect(p.outcome).toBe('ready');
    expect(selects).toBe(2);
    expect(labels(p)).toContain('The model took too long, so Sieve asked it once more');
    timesOut(2);
    const q = await prepareProposal(input({ question: 'When do I pick up Bella?' }));
    expect(q.outcome).toBe('error');
    expect(q.errorCode).toBe('model-timeout');
    expect(selects).toBe(2);
  });

  it('a check that cannot run leaves the answer for the person, with a warning (no auto-approve)', async () => {
    idx.search.mockResolvedValue([idx.cand(SUNNY_PAWS.id)]);
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
