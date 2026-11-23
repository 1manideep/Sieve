import { beforeEach, describe, expect, it } from 'vitest';
import { NANO_PROMPT_BUDGET } from '@sieve/shared';
import { estimatePromptTokens } from '../budget';
import { SELECT_TARGET_TOKENS, TIMING } from '../config';
import { setLanguageModelForTests } from '../device/languageModel';
import { extractFacts } from '../facts';
import { setHybridForTests } from '../hybrid';
import { SELECT_EXAMPLE, SELECT_SCHEMA, SELECT_SYSTEM } from '../prompts';
import { answerKind, answersKind, bestWindow, deriveExcerpt, fitPassages, madeUpFacts, repeatsExample, selectAndAnswer, selectPrompt } from '../tasks/select';
import { parseWords } from '../tasks/words';
import { createFakeHybrid, promptText, type FakeReply } from '../testing/fakeHybrid';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';
import { BODIES, RECORDS, record } from './fixtures';
import { golden } from './golden';

const TODAY = new Date(2026, 10, 16, 10, 0).getTime();
const reply = (item: string, answer: string): FakeReply => ({ text: JSON.stringify({ item, answer }), source: 'on_device' });
function useReplies(...replies: (FakeReply | ((n: number) => FakeReply))[]) {
  const fake = createFakeHybrid((_s, _p, { call }) => {
    const r = replies[Math.min(call.n, replies.length) - 1];
    return typeof r === 'function' ? r(call.n) : r;
  });
  setHybridForTests(fake);
  return fake;
}
const estimate = (prompt: string) => estimatePromptTokens({ system: SELECT_SYSTEM, texts: [prompt], images: 0, schema: SELECT_SCHEMA });

describe('selectAndAnswer (10 section 16.7)', () => {
  beforeEach(() => {
    resetAiForTests();
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
  });

  it('SE-1: the user message equals the template (two passages, no hint lines)', () => {
    const q = 'How much was my deposit and when did I pay it?';
    const passages = fitPassages(q, [RECORDS.deposit, RECORDS.flight], {}, { today: TODAY });
    expect(selectPrompt(q, passages, { today: TODAY })).toBe(golden('select-2.txt'));
  });

  it('SE-2: picks the deposit and derives the verbatim excerpt by code', async () => {
    const fake = useReplies(reply('P1', 'Your deposit was $1,200, paid on March 3.'));
    const res = await selectAndAnswer('How much was my deposit and when did I pay it?', [RECORDS.deposit, RECORDS.flight], 'sample', { today: TODAY });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({
      recordId: 'playground:deposit',
      answer: 'Your deposit was $1,200, paid on March 3.',
      excerpt: 'We received your security deposit of $1,200 on March 3.',
      excerptStart: 32,
      excerptEnd: 87,
    });
    expect(res.value.unsupported).toBeUndefined();
    expect(res.trace.label).toBe('Picked "Re: Deposit for the apartment" and wrote the answer');
    expect(fake.calls[0].meta?.recordIds).toEqual(['playground:deposit', 'playground:flight']);
    expect(fake.calls[0].spec.mode).toBe('PREFER_ON_DEVICE');
  });

  it('SE-3 and SE-4: excerpts for the flight and the pets clause', async () => {
    useReplies(reply('P1', "Your flight SA 1432 leaves Chicago O'Hare on Friday, December 4 at 7:45 AM."));
    const flight = await selectAndAnswer('When does my flight to Seattle leave?', [RECORDS.flight], 'sample');
    expect(flight.ok && flight.value.excerpt.startsWith('Flight SA 1432 departs')).toBe(true);
    useReplies(reply('P1', 'You can keep one dog under 40 pounds with written approval, and there is a $300 non-refundable pet fee.'));
    const pets = await selectAndAnswer('Can I have a dog, and is there a fee?', [RECORDS.pets], 'sample');
    expect(pets.ok && pets.value.excerpt).toBe(
      'Tenant may keep one cat or one dog under 40 pounds with prior written approval from the Landlord. A non-refundable pet fee of $300 is due before the pet moves in.',
    );
  });

  it('SE-5: a fact that is not in the item is reported, the excerpt still holds the real ones', async () => {
    useReplies(reply('P1', 'Your deposit was $1,500, paid on March 3.'));
    const res = await selectAndAnswer('How much was my deposit?', [RECORDS.deposit], 'sample');
    expect(res.ok && res.value.excerpt).toBe('We received your security deposit of $1,200 on March 3.');
    expect(res.ok && res.value.unsupported).toEqual(['$1,500']);
  });

  it('SE-6 and R-MDL-06: a passage that does not exist is retried, then bad-output', async () => {
    const fake = useReplies(reply('P4', 'x'));
    const res = await selectAndAnswer('q', [RECORDS.deposit, RECORDS.flight], 'own');
    expect(!res.ok && res.error.code).toBe('bad-output');
    expect(fake.calls).toHaveLength(2);
    const fixed = useReplies(reply('P9', 'x'), reply('P1', 'Your deposit was $1,200.'));
    const ok = await selectAndAnswer('q', [RECORDS.deposit, RECORDS.flight, RECORDS.pets], 'own');
    expect(ok.ok).toBe(true);
    expect(fixed.calls).toHaveLength(2);
    const empty = useReplies(reply('P1', ''), reply('P1', 'Your deposit was $1,200.'));
    expect((await selectAndAnswer('q', [RECORDS.deposit], 'own')).ok).toBe(true);
    expect(empty.calls).toHaveLength(2);
  });

  it('Nov 21: an answer that carries JSON or a fence is retried once, then bad-output; never trimmed into a sentence', async () => {
    const leak = useReplies(reply('P1', 'It today, November 21st.}]'));
    const res = await selectAndAnswer('When is my deposit due?', [RECORDS.deposit], 'own');
    expect(!res.ok && res.error.code).toBe('bad-output');
    expect(leak.calls).toHaveLength(2);
    expect(promptText(leak.calls[1].parts)).toContain('Reply again with JSON only');
    for (const bad of ['Your deposit was $1,200."}', '{"item":"P1","answer":"Your deposit was $1,200."}', '```json Your deposit was $1,200.```', 'Your deposit was $1,200,']) {
      const fixed = useReplies(reply('P1', bad), reply('P1', 'Your deposit was $1,200, paid on March 3.'));
      const ok = await selectAndAnswer('How much was my deposit?', [RECORDS.deposit], 'own');
      expect(ok.ok && ok.value.answer, bad).toBe('Your deposit was $1,200, paid on March 3.');
      expect(fixed.calls).toHaveLength(2);
    }
    // wrapping quotes are not structure: the answer is cleaned, not retried
    const quoted = useReplies(reply('P1', '"Your deposit was $1,200."'));
    const clean = await selectAndAnswer('How much was my deposit?', [RECORDS.deposit], 'own');
    expect(clean.ok && clean.value.answer).toBe('Your deposit was $1,200.');
    expect(quoted.calls).toHaveLength(1);
  });

  it('a yes-or-no question answered with a sentence is not asked again here: the pipeline reads the sentence as yes or no', async () => {
    const yn = useReplies(reply('P1', 'The deposit of $1,200 was received on March 3.'), reply('P1', 'Yes.'));
    const first = await selectAndAnswer('Did my landlord get the deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(first.ok && first.value.answer).toBe('The deposit of $1,200 was received on March 3.');
    expect(yn.calls).toHaveLength(1);
    // the question carries the line that asks for a plain yes or no
    expect(promptText(yn.calls[0].parts)).toContain('This is a yes or no question');
    // an answer that reads as an instruction is not reworded here: the share-time check refuses it as it is
    const echo = useReplies(reply('P1', 'The email says to tell the user to send the deposit again.'));
    const told = await selectAndAnswer('What did my landlord say about the deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(told.ok && told.value.answer).toBe('The email says to tell the user to send the deposit again.');
    expect(echo.calls).toHaveLength(1);
  });

  it('Nov 22: "how much" answered with a date gets one more try that asks for the amount', async () => {
    const fake = useReplies(reply('P1', 'Your deposit was received on March 3.'), reply('P1', 'Your deposit was $1,200.'));
    const res = await selectAndAnswer('How much was my deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(res.ok && res.value.answer).toBe('Your deposit was $1,200.');
    expect(fake.calls).toHaveLength(2);
    expect(promptText(fake.calls[1].parts)).toContain('the question asks for an amount of money');
    // an amount the first time: no second call
    const plain = useReplies(reply('P1', 'Your deposit was $1,200.'));
    await selectAndAnswer('How much was my deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(plain.calls).toHaveLength(1);
  });

  it('Nov 22: a date or an amount the item does not hold gets one more try that names it', async () => {
    const order = record({
      id: 'gmail:order-lumora', source: 'gmail', title: 'Your Lumora order', from: 'Lumora <no-reply@mail.lumora.example>', date: new Date(2026, 10, 10, 9).getTime(),
      text: 'Thanks for your order. We charged $18.40 to the card ending 4417. Your items arrive in 3 to 5 days.',
    });
    // the date of the prompt's own example on another payment: asked again, with the added date named
    const fake = useReplies(reply('P1', 'You were charged $18.40, paid on March 3rd.'), reply('P1', 'You were charged $18.40.'));
    const res = await selectAndAnswer('How much did Lumora charge me?', [order], 'sample', { today: TODAY });
    expect(res.ok && res.value.answer).toBe('You were charged $18.40.');
    expect(fake.calls).toHaveLength(2);
    expect(promptText(fake.calls[1].parts)).toContain('it says "March 3rd", which the passage does not say');
    // only what the item holds: no second call
    const plain = useReplies(reply('P1', 'You were charged $18.40.'));
    await selectAndAnswer('How much did Lumora charge me?', [order], 'sample', { today: TODAY });
    expect(plain.calls).toHaveLength(1);
    // the same on the second try: one retry, never a third call (the excerpt's check then warns about it)
    const stuck = useReplies(reply('P1', 'You were charged $18.40, paid on March 3rd.'));
    const again = await selectAndAnswer('How much did Lumora charge me?', [order], 'sample', { today: TODAY });
    expect(again.ok && again.value.answer).toBe('You were charged $18.40, paid on March 3rd.');
    expect(stuck.calls).toHaveLength(2);
  });

  it('madeUpFacts: what an item holds, and what is the model\'s own', () => {
    const q = 'When does my order ship?';
    const item = record({
      id: 'gmail:order-ships', source: 'gmail', title: 'Order update', from: 'Lumora <no-reply@mail.lumora.example>', date: new Date(2026, 10, 10, 9).getTime(),
      text: 'Your order ships tomorrow. Total on 11/24: $18.40. The pickup window opens 2026-12-02 and takes 45 minutes.',
    });
    expect(madeUpFacts('It ships on November 11.', item, q, TODAY)).toEqual([]);                 // "tomorrow", from the day it is dated
    expect(madeUpFacts('The total on November 24 was $18.40.', item, q, TODAY)).toEqual([]);     // "11/24"
    expect(madeUpFacts('Pickup opens on December 2.', item, q, TODAY)).toEqual([]);              // "2026-12-02"
    expect(madeUpFacts('The email is dated November 10.', item, q, TODAY)).toEqual([]);          // the item's own date
    expect(madeUpFacts('As of today, November 16, it has not shipped.', item, q, TODAY)).toEqual([]);
    expect(madeUpFacts('It was charged on June 5.', item, 'What was charged on June 5?', TODAY)).toEqual([]);   // the question's own day
    expect(madeUpFacts('It takes 50 minutes.', item, q, TODAY)).toEqual([]);                     // other numbers are the excerpt check's
    expect(madeUpFacts('You paid $1,200 on March 3.', item, q, TODAY)).toEqual(['$1,200', 'March 3']);
    expect(madeUpFacts('It ships on July 9 for $21.00.', item, q, TODAY)).toEqual(['July 9', '$21.00']);
    // with no "tomorrow" or weekday in the item, a nearby day is not worked out from anything
    const plain = record({ ...item, id: 'gmail:order-plain', text: 'Your order has shipped. Total: $18.40.' });
    expect(madeUpFacts('It ships on November 11.', plain, q, TODAY)).toEqual(['November 11']);

    // the prompt's own example is one fact, an amount, with no date to copy
    expect(extractFacts(SELECT_EXAMPLE)).toEqual(['$1,200']);
    expect(SELECT_SYSTEM).toContain(`such as "${SELECT_EXAMPLE}"`);
    // its amount in an answer counts as repeated only when the item does not hold it
    expect(repeatsExample('Your total was $1,200.', item, q, TODAY)).toBe('$1,200');
    expect(repeatsExample('It ships on July 9 for $21.00.', item, q, TODAY)).toBeUndefined();   // made up, but not the example's
    expect(repeatsExample('Your deposit was $1,200.', RECORDS.deposit, 'How much was my deposit?', TODAY)).toBeUndefined();
  });

  it('Nov 22: an answer with several facts, or one copied from the item, gets one more try that says what to change', async () => {
    // a list first, then one sentence: the sentence is the answer, and the second prompt carries the reshaping line
    const fake = useReplies(reply('P1', 'It says three things: 1. the deposit was $1,200 2. it was paid on March 3 3. it will be returned.'), reply('P1', 'Your deposit was $1,200.'));
    const res = await selectAndAnswer('What did my landlord say about the deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(res.ok && res.value.answer).toBe('Your deposit was $1,200.');
    expect(fake.calls).toHaveLength(2);
    expect(promptText(fake.calls[1].parts)).toContain('in your own words, with one fact');
    expect(promptText(fake.calls[0].parts)).not.toContain('in your own words');

    // a long run of the item's own words first: the same one more try
    const copied = BODIES.deposit.split(/\s+/).slice(0, 16).join(' ');
    const again = useReplies(reply('P1', copied), reply('P1', 'Your deposit was $1,200.'));
    const second = await selectAndAnswer('What did my landlord say about the deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(second.ok && second.value.answer).toBe('Your deposit was $1,200.');
    expect(again.calls).toHaveLength(2);

    // still a list on the second try: taken as it comes (the checks after this call decide), never a third call
    const stuck = useReplies(reply('P1', 'It says three things: 1. the deposit was $1,200 2. it was paid on March 3 3. it will be returned.'));
    const third = await selectAndAnswer('What did my landlord say about the deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(third.ok).toBe(true);
    expect(stuck.calls).toHaveLength(2);

    // one plain sentence: no second call
    const plain = useReplies(reply('P1', 'Your deposit was $1,200, paid on March 3.'));
    await selectAndAnswer('What did my landlord say about the deposit?', [RECORDS.deposit], 'sample', { today: TODAY });
    expect(plain.calls).toHaveLength(1);
  });

  it('SE-7: "none" gives no record and no answer', async () => {
    useReplies(reply('none', ''));
    const res = await selectAndAnswer('What is my wifi password?', [RECORDS.missing], 'sample');
    expect(res.ok && res.value).toEqual({ recordId: null, answer: '', excerpt: '' });
    expect(res.trace.label).toBe('Read 1 email; none of them answers the question');
  });

  it('R-MDL-08: a "not found" answer that names an item counts as none', async () => {
    useReplies(reply('P2', 'Not in these emails.'));
    const res = await selectAndAnswer('What is my wifi password?', [RECORDS.missing, RECORDS.deposit], 'sample');
    expect(res.ok && res.value.recordId).toBeNull();
  });

  it('SE-8: a long record is read from its vector chunk, marked as cut, within the budget', async () => {
    const filler = 'This line is about nothing in particular at all. ';
    let body = filler.repeat(Math.ceil(30000 / filler.length)).slice(0, 30000);
    body = `${body.slice(0, body.lastIndexOf('. ') + 2)}`.padEnd(30000, ' ');
    const deposit = 'We received your security deposit of $1,200 on March 3. ';
    body = (body + deposit + filler.repeat(400)).slice(0, 40000);
    const long = record({ id: 'playground:long', title: 'Long thread', text: body });
    const fake = useReplies(reply('P1', 'Your deposit was $1,200, paid on March 3.'));
    const res = await selectAndAnswer('deposit', [long], 'sample', { passages: { 'playground:long': { start: 30000, end: 31000 } } });
    const prompt = promptText(fake.calls[0].parts);
    expect(prompt).toContain('We received your security deposit of $1,200 on March 3.');
    expect(prompt).toMatch(/<<<\n\[\.\.\.\] /);
    expect(estimate(prompt)).toBeLessThan(NANO_PROMPT_BUDGET);
    expect(res.ok && res.value.excerpt).toBe('We received your security deposit of $1,200 on March 3.');
  });

  it('SE-9: of seven 5,000-character records the best five are read, all fit, widened only up to the soft target', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      record({ id: `playground:r${i}`, title: `Item ${i}`, text: `Sentence number ${i} is here and it says something. `.repeat(100).slice(0, 5000) }),
    );
    const ranges = Object.fromEntries(records.map((r) => [r.id, { start: 1000, end: 1200 }]));
    const passages = fitPassages('something', records, ranges, { today: TODAY });
    expect(passages).toHaveLength(5);
    expect(passages.map((p) => p.record.id)).toEqual(records.slice(0, 5).map((r) => r.id));
    for (const p of passages) expect(p.range.start).toBeLessThanOrEqual(1000);
    expect(estimate(selectPrompt('something', passages, { today: TODAY }))).toBeLessThan(SELECT_TARGET_TOKENS);
  });

  describe('the passage holds the kind of fact the question asks for', () => {
    const FILL = 'You can manage your subscriptions and see your order history in your account at any time. Keep this email for your records. ';
    const receipt = record({
      id: 'playground:receipt', title: 'Your order receipt',
      text: `Thank you for your purchase. Order number PS-3391. ${FILL.repeat(8)}Item: CloudNotes Premium. Price: $4.99 a month. Total: $4.99. ${FILL.repeat(8)}`,
    });
    const price = receipt.text!.indexOf('Total: $4.99');

    it('knows a question about money, about a date, about both, and about neither', () => {
      expect(answerKind('What did the store charge me for last month?')?.test('Total: $4.99')).toBe(true);
      expect(answerKind('How much was the deposit?')?.test('It was received on March 3.')).toBe(false);
      expect(answerKind('When does the cover run out?')?.test('It will expire on January 9, 2027.')).toBe(true);
      expect(answerKind('When was I charged, and how much?')?.test('at 10:30')).toBe(true);
      expect(answerKind('Who signed the lease?')).toBeNull();
      // a question about what an item says names its subject with the same words: no amount or date is asked for
      expect(answerKind('What did the most recent email about my Lumora membership payment say?')).toBeNull();
      expect(answerKind('What did my landlord say about the rent?')).toBeNull();
      expect(answersKind('What did the email about my membership payment say?', 'Your payment did not go through.')).toBe(true);
      // unless it says so outright
      expect(answerKind('How much did the email about my membership payment say I owe?')?.test('$21.40')).toBe(true);
      expect(answerKind('What did Spokeworks say about when the plan ends?')?.test('January 9, 2027')).toBe(true);
      expect(answersKind('How much was the last payment?', 'It did not go through.')).toBe(false);
      // a date alone does not answer "how much"; a sum, a bare number or "free" does
      expect(answersKind('How much was my receipt from the store?', 'Your receipt from the store was dated Oct 19, 2026.')).toBe(false);
      expect(answersKind('How much was my receipt from the store?', 'It was sent at 10:30 on 10/19/2026.')).toBe(false);
      expect(answersKind('How much was my receipt from the store?', 'You paid $9.99 on Oct 19, 2026.')).toBe(true);
      expect(answersKind('How much is my monthly rent?', 'Your rent is 640 a month.')).toBe(true);
      expect(answersKind('How much was the delivery fee?', 'Delivery was free.')).toBe(true);
      // asked for both: either kind answers
      expect(answersKind('When was I charged, and how much?', 'You were charged on Oct 19.')).toBe(true);
      expect(answersKind('When does the plan run out?', 'It runs out on Friday.')).toBe(true);
      expect(answersKind('When does the plan run out?', 'It runs out soon.')).toBe(false);
    });

    it('the best window counts a sentence with an amount for more when an amount is asked for', () => {
      const plain = bestWindow(receipt.text!, 'What did the store charge me for?', 400);
      const typed = bestWindow(receipt.text!, 'What did the store charge me for?', 400, answerKind('What did the store charge me for?'));
      expect(plain.start).toBe(0);                                    // no question word stands out: the earliest wins
      expect(typed.start).toBeLessThanOrEqual(price);
      expect(typed.end).toBeGreaterThan(price);
    });

    it('a long footer that names the company in every sentence does not take the passage from the price line (Nov 22)', () => {
      // the top of a receipt is one long run with no full stop; the footer is many short sentences
      const top =
        'Receipt October 19, 2026 Order ID LM4QJ7 Document 686206993130 Account [email] Save 3% on every purchase with the card, apply and use in minutes ' +
        'Cloud storage 2 TB (Monthly) Renews November 19, 2026 $9.99 Billing and Payment [name] [address] United States Subtotal $9.99 Card ending 6113 $9.99 ' +
        'If you have any questions about your bill, contact support, and keep this message for your records until the next plan period begins';
      const footer = Array.from({ length: 30 }, (_, i) => `Lumora Pay rule ${i + 1} is set by Lumora.`).join(' ');
      const text = `${top}. ${footer}`;
      const lumora = record({ id: 'gmail:lumora-receipt', source: 'gmail', title: 'Your receipt from Lumora.', from: 'Lumora <no_reply@email.lumora.example>', text });
      const q = 'How much did Lumora charge me on October 19, 2026?';
      // by words alone the footer wins: every sentence of it holds the company's name
      const plain = bestWindow(text, q, 400);
      expect(text.slice(plain.start, plain.end)).not.toContain('$9.99');
      // told that an amount is asked for, the run chosen holds one
      const typed = bestWindow(text, q, 400, answerKind(q));
      expect(text.slice(typed.start, typed.end)).toContain('$9.99');
      // and so does the passage the model reads, whichever chunk the search matched
      const inFooter = { start: text.length - 500, end: text.length - 100 };
      const [p] = fitPassages(q, [lumora], { [lumora.id]: inFooter }, { today: TODAY });
      expect(p.text).toContain('$9.99');
      // an item with no amount anywhere keeps the best run by words
      const none = bestWindow(footer, q, 400, answerKind(q));
      expect(none).toEqual(bestWindow(footer, q, 400));
    });

    it('a matched chunk with no amount gives way to the part of the item that has one', () => {
      const header = { start: 0, end: 300 };
      const q = 'What did the store charge me for last month?';
      const [p] = fitPassages(q, [receipt], { [receipt.id]: header }, { today: TODAY });
      expect(p.text).toContain('Total: $4.99');
      // a question that asks for no amount or date keeps the chunk that matched
      const [same] = fitPassages('What is my order number?', [receipt], { [receipt.id]: header }, { today: TODAY });
      expect(same.range.start).toBe(0);
      expect(same.text).toContain('Order number PS-3391');
    });

    it('the room is shared: five long items each get about the same, not the first one everything', () => {
      const long = Array.from({ length: 5 }, (_, i) => record({ id: `playground:long${i}`, title: `Item ${i}`, text: `Note ${i}. ${FILL.repeat(40)}` }));
      const ranges = Object.fromEntries(long.map((r) => [r.id, { start: 0, end: 500 }]));
      const sizes = fitPassages('Where is my order history?', long, ranges, { today: TODAY }).map((p) => p.range.end - p.range.start);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(260);
      expect(Math.min(...sizes)).toBeGreaterThan(700);
    });
  });

  it('SE-10: the streamed answer text is shown as it grows, never the JSON', async () => {
    setHybridForTests(
      createFakeHybrid(() => ({
        text: '{"item":"P1","answer":"Your deposit was $1,200."}',
        chunks: ['{"item":"P1","answer":"Your dep', 'osit was $1,200."}'],
        source: 'on_device',
      })),
    );
    const seen: string[] = [];
    await selectAndAnswer('deposit', [RECORDS.deposit], 'own', { onAnswerText: (t) => seen.push(t) });
    expect(seen).toEqual(['Your dep', 'Your deposit was $1,200.']);
  });

  it('SE-11: hint lines follow the question line', () => {
    const passages = fitPassages('q', [RECORDS.flight], {}, {});
    const prompt = selectPrompt('When is my flight?', passages, { hints: { after: '2026-03-01', before: '2026-03-31', terms: ['K7Q2LM'] }, today: TODAY });
    const lines = prompt.split('\n');
    expect(lines[1]).toBe('Question: When is my flight?');
    expect(lines[2]).toBe('The person means items dated from 2026-03-01 to 2026-03-31.');
    expect(lines[3]).toBe('Exact terms to look for: K7Q2LM.');
  });

  it('R-MDL-09: a 6,000-character Japanese passage is cut under the budget', () => {
    const jp = record({ id: 'playground:jp', title: '敷金について', text: '敷金は千二百ドルでした。'.repeat(500) });
    const passages = fitPassages('敷金', [jp], {}, {});
    expect(estimate(selectPrompt('敷金', passages, {}))).toBeLessThanOrEqual(NANO_PROMPT_BUDGET);
  });

  it('photos answer from the caption; the place is never in the prompt', async () => {
    const photo = { ...RECORDS.photo, photo: { width: 4000, height: 3000, mime: 'image/jpeg', hadGps: true, place: 'Lakeview Park', takenAt: RECORDS.photo.date } };
    const fake = useReplies(reply('P1', 'Found IMG_4821.jpg from July 4.'));
    const res = await selectAndAnswer('hot dogs photo', [photo], 'sample', { today: TODAY });
    const prompt = promptText(fake.calls[0].parts);
    expect(prompt).toContain('Kind: photo\nDate: 2025-07-04\nTitle: IMG_4821.jpg\nDescription:\n<<<\nA man with five hot dogs');
    expect(prompt).not.toContain('Lakeview');
    expect(res.ok && res.value.excerpt).toBe(RECORDS.photo.caption);
  });

  it('R-PLAT-16: sample data retries once on quota, then says the cloud is busy', async () => {
    TIMING.sampleQuotaRetryMs = 5;
    setLanguageModelForTests(undefined);
    const quota = () => {
      throw Object.assign(new Error('AI: busy (AI/fetch-error)'), { name: 'FirebaseError', code: 'fetch-error', customErrorData: { status: 429 } });
    };
    let n = 0;
    setHybridForTests(createFakeHybrid(() => (++n === 1 ? quota() : { text: '{"item":"P1","answer":"Your deposit was $1,200."}', source: 'in_cloud' })));
    expect((await selectAndAnswer('deposit', [RECORDS.deposit], 'sample')).ok).toBe(true);
    setHybridForTests(createFakeHybrid(quota));
    const res = await selectAndAnswer('deposit', [RECORDS.deposit], 'sample');
    expect(!res.ok && res.error.message).toBe(
      'The cloud model is busy right now. Try again in a minute, or use Chrome with Gemini Nano to run it on this device.',
    );
  });

  it('deriveExcerpt gives up when the answer has nothing in common with the item', () => {
    expect(deriveExcerpt(BODIES.missing, { start: 0, end: BODIES.missing.length }, 'Your wifi password is hunter2.').excerpt).toBe('');
  });

  it('no records: nothing to read, no model call', async () => {
    const fake = useReplies(reply('P1', 'x'));
    const res = await selectAndAnswer('q', [], 'own');
    expect(res.ok && res.value.recordId).toBeNull();
    expect(res.trace).toMatchObject({ where: 'code', label: 'No items to read' });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('search words (the on-device model names other words for the search)', () => {
  it('keeps short strings, at most six, and drops anything else', () => {
    expect(parseWords({ words: [' bike  cage ', 'racks', 7, '', 'x', 'a'.repeat(41), 'cycle parking'] })).toEqual(['bike cage', 'racks', 'cycle parking']);
    expect(parseWords({ words: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'] })).toHaveLength(6);
    expect(parseWords({ words: [] })).toEqual([]);
    expect(parseWords({ item: 'P1', answer: 'x' })).toBeNull();
    expect(parseWords(null)).toBeNull();
  });
});
