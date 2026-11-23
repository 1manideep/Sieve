// The second real test (Nov 21: 20 attack probes through Claude's connector, answer-only level), privacy side:
// B15 a yes or no about a background check, B05 a sender and an exact subject, B13 and B05 two facts in one answer,
// B01 a list of names, B09 "N3stra" masked as an ID number, and the sensitive-topic detector (11 sections 10.3a, 11.5).
import type { IndexRecord, KnownEntity } from '@sieve/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPrivacyModelHost } from '../model/client';
import { looksLikeIdNumber } from '../pii/validators/idNumber';
import { clearScanMemo } from '../scan/scan';
import { itemTouchesSensitiveTopic, sensitiveTopicOf, touchesSensitiveTopic } from '../sensitive';
import { asksAddress, asksSubject, firstFactClause, hasList, isYesNoQuestion, packsSeveralFacts, shapeAnswer, stripSubject } from '../steps/answerShape';
import { buildStepOption, UNAVAILABLE } from '../steps/build';

const ai = vi.hoisted(() => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));
vi.mock('../../ai', () => ai);

beforeEach(() => {
  clearScanMemo();
  setPrivacyModelHost(null);
  ai.getNanoAvailability.mockReset().mockResolvedValue({ text: 'unavailable', image: 'unavailable' });
});

function rec(over: Partial<IndexRecord> & Pick<IndexRecord, 'id' | 'from' | 'text' | 'title'>): IndexRecord {
  return {
    source: 'gmail', sourceRef: over.id.split(':')[1]!, kind: 'email', date: Date.UTC(2026, 10, 18), preview: over.text!.slice(0, 200),
    category: 'Work', categoryBy: 'device', hiddenRemoved: [], pii: [], sizeBytes: over.text!.length, indexedAt: 0, contentHash: 'h', version: 1,
    ...over,
  };
}

const opts = (question: string, extra: { extraEntities?: KnownEntity[]; knownSenders?: Set<string>; knownOrgs?: Set<string> } = {}) => ({ question, maxStep: 'answer' as const, ...extra });
const isPerson = () => false;

const CHECKR = rec({
  id: 'gmail:checkr', from: 'Checkr <no-reply@checkr.com>', title: 'Your background check is complete',
  text: 'Hi Alex, your background check for Kestrel Labs is complete. Report date: October 3, 2026.',
});
const AMAZON = rec({
  id: 'gmail:amazon', from: 'Amazon <auto-confirm@amazon.com>', title: 'Your order of Echo Dot has shipped',
  text: 'Your order of Echo Dot has shipped. It arrives Friday.', category: 'Shopping',
});
const AWS = rec({
  id: 'gmail:aws', from: 'Amazon Web Services <aws-billing@amazon.com>', title: 'Your AWS Free Tier period has ended',
  text: 'Account ID: 123456789012. Your AWS Free Tier ended on October 26, 2026.', category: 'Money',
});

describe('B15: a yes or no question gets exactly "Yes." or "No."', () => {
  it('reads the question shape', () => {
    for (const q of ['Did I have a background check?', 'Is my flight on Friday?', 'Was the deposit returned?', 'Has HelloSign sent the lease?', 'Do I have a dentist appointment next week?', 'Yes or no: did Checkr email me?']) {
      expect(isYesNoQuestion(q), q).toBe(true);
    }
    for (const q of ['What did my landlord say about the deposit?', 'Did Benji say when the release is?', 'Is the party on Friday or Saturday?', 'Do you know my AWS account ID?', 'When is my flight?']) {
      expect(isYesNoQuestion(q), q).toBe(false);
    }
  });

  it('keeps the first word, never the sender or the date', async () => {
    const o = await buildStepOption('answer', { answer: 'Yes, Checkr sent your background check results on October 3.' }, CHECKR, 'own', opts('Did I have a background check?'));
    expect(o).toMatchObject({ available: true, text: 'Yes.' });
    const no = await buildStepOption('answer', { answer: 'No, nothing from Checkr since October.' }, CHECKR, 'own', opts('Has Checkr emailed me this week?'));
    expect(no.text).toBe('No.');
  });

  it('an answer that is not a yes or no is not offered', async () => {
    const o = await buildStepOption('answer', { answer: 'Checkr sent your background check results on October 3.' }, CHECKR, 'own', opts('Did I have a background check?'));
    expect(o).toMatchObject({ available: false, unavailableReason: UNAVAILABLE.notYesNo });
  });
});

describe('B05, B13, B01: one fact per answer', () => {
  it('B13: two clauses, each with its own fact, are more than one fact: only the first is shared', async () => {
    const text = 'Your AWS account ID is 123456789012, and your free plan ended on October 26.';
    expect(packsSeveralFacts(text)).toBe(true);
    const o = await buildStepOption('answer', { answer: text }, AWS, 'own', opts('What is my AWS account ID?'));
    expect(o.available).toBe(true);
    expect(o.text).toMatch(/^Your AWS account ID is /);
    expect(o.text).not.toContain('October 26');
    expect(o.text).not.toContain('free plan');
    expect(firstFactClause('Your order US20418833 has been cancelled. A refund of $48.00 is on its way.')).toBe('Your order US20418833 has been cancelled.');
    expect(firstFactClause('It is fine, and so is this.')).toBeNull();
    expect(packsSeveralFacts('Your AWS account ID is [id number], and your free plan ended on October 26.')).toBe(true);
    expect(packsSeveralFacts('Your AWS account ID is 123456789012. Your free plan ended on October 26.')).toBe(true);
  });

  it('B05: the sender and the subject joined in two clauses are two facts: the second is not shared', async () => {
    const text = 'Your latest email is from Amazon, and its subject is "Your order of Echo Dot has shipped".';
    const o = await buildStepOption('answer', { answer: text }, AMAZON, 'own', opts('What is my latest email about?'));
    expect(o.available).toBe(true);
    expect(o.text).toBe('Your latest email is from Amazon.');
    // a list is still refused whole
    const list = await buildStepOption('answer', { answer: 'You paid $12, $40 and $7.' }, AMAZON, 'own', opts('What did I pay?'));
    expect(list.unavailableReason).toBe(UNAVAILABLE.oneFact);
  });

  it('B01: a list of names, masked or not, and numbered items', () => {
    expect(hasList('Your last five emails are from Priya Shah, Dana Lee, Benji Kumar, Ivo Lindqvist and Amazon.')).toBe(true);
    expect(hasList('Your last five emails are from [name 1], [name 2], [name 3], [name 4] and [name 5].')).toBe(true);
    expect(hasList('You paid $12, $40 and $7.')).toBe(true);
    expect(packsSeveralFacts('1) Amazon shipped your order 2) Strava sent a weekly summary')).toBe(true);
  });

  it('one fact in one sentence stays, with its amount and date, its time and its place', () => {
    for (const t of [
      'Your deposit was $1,200, paid on March 3.',
      'Your flight SA 1432 departs Chicago on Friday, December 4, at 9:40 AM.',
      'It asks you to pay a $2 redelivery fee through a link, which looks like a scam.',
      'Your new address is 123 Main St, Springfield, IL 62704.',
      'Your November statement shows the latest balance.',
      'Your package from Amazon arrives Friday, and UPS will need a signature.',
    ]) {
      expect(packsSeveralFacts(t), t).toBe(false);
    }
  });
});

describe('B05: never the subject line or the sender address, unless asked', () => {
  it('strips the subject (4 or more words of it in a row) and puts the organisation in place of its address', async () => {
    const answer = 'Your latest email is from auto-confirm@amazon.com with the subject "Your order of Echo Dot has shipped".';
    const o = await buildStepOption('answer', { answer }, AMAZON, 'own', opts('What is my latest email about?'));
    expect(o).toMatchObject({ available: true, text: 'Your latest email is from Amazon.' });
  });

  it('an answer that states what the subject says is kept: only a citation of the subject is taken out', async () => {
    const o = await buildStepOption('answer', { answer: 'Your order of Echo Dot has shipped.' }, AMAZON, 'own', opts('What happened with my Amazon order?'));
    expect(o).toMatchObject({ available: true, text: 'Your order of Echo Dot has shipped.' });
    expect(stripSubject('Your order of Echo Dot has shipped and arrives Friday.', AMAZON.title)).toBe('Your order of Echo Dot has shipped and arrives Friday.');
    expect(stripSubject('The email titled "Your order of Echo Dot has shipped" says it arrives Friday.', AMAZON.title)).toBe('The email says it arrives Friday.');
    expect(stripSubject('Re: the lease is ready', 'Re: Lease')).toBe('Re: the lease is ready');   // a short subject is never stripped
    // an answer that is only the cited subject stays whole
    const only = await buildStepOption('answer', { answer: 'The subject is "Your order of Echo Dot has shipped".' }, AMAZON, 'own', opts('What happened with my Amazon order?'));
    expect(only.available).toBe(true);
  });

  it('a question that asks for the subject or the address gets it', async () => {
    expect(asksSubject("What's the subject of my latest Amazon email?")).toBe(true);
    const subject = await buildStepOption('answer', { answer: 'The subject is "Your order of Echo Dot has shipped".' }, AMAZON, 'own', opts("What's the subject of my latest Amazon email?"));
    expect(subject.text).toBe('The subject is "Your order of Echo Dot has shipped".');
    expect(asksAddress('What email address did Amazon write from?')).toBe(true);
    const shaped = shapeAnswer('Amazon wrote from auto-confirm@amazon.com.', AMAZON, 'What email address did Amazon write from?', isPerson);
    expect(shaped).toEqual({ ok: true, text: 'Amazon wrote from auto-confirm@amazon.com.' });
  });

  it("a person's address is removed and their name follows the mask rule; an organisation's name stays", async () => {
    const priya = rec({ id: 'gmail:priya', from: 'Priya Shah <priya.shah@gmail.com>', title: 'Saturday run', text: 'See you at the Saturday run at 7.' });
    const o = await buildStepOption('answer', { answer: 'Priya Shah (priya.shah@gmail.com) said the run starts at 7.' }, priya, 'own', opts('When does the Saturday run start?'));
    expect(o.text).toBe('[name] said the run starts at 7.');
    const org = await buildStepOption('answer', { answer: 'Checkr finished your report on October 3.' }, CHECKR, 'own', opts('When did my report finish?', { extraEntities: [{ text: 'Checkr', type: 'name', by: 'nano' }] }));
    expect(org.text).toBe('Checkr finished your report on October 3.');
  });
});

describe('B09: a brand with a digit or two is not an ID number', () => {
  it('needs 4 or more digits or an ID shape, and never a sender of the index', () => {
    for (const v of ['N3stra', '1Password', '3M', 'web3', 'K7Q2LM', 'B12']) expect(looksLikeIdNumber(v), v).toBe(false);
    for (const v of ['123456789012', 'X1234567', 'RI-2026-88431', '#482', 'No. 12', 'RX-66']) expect(looksLikeIdNumber(v), v).toBe(true);
    expect(looksLikeIdNumber('Zip2024', new Set(['zip2024']))).toBe(false);
    expect(looksLikeIdNumber('N3stra4', new Set(['nestra']))).toBe(false);   // look-alike digits read as letters
    // an amount of money or a whole sentence is never an ID, however many digits it holds
    for (const v of ['$40.00 USD', '$2,480.00', '2,480.00 INR', 'under $40.00 USD', 'Your pass credit is under $40.00 USD today']) expect(looksLikeIdNumber(v), v).toBe(false);
    for (const v of ['member 4471 2209', 'policy number AB-448812']) expect(looksLikeIdNumber(v), v).toBe(true);
  });

  it('a company of the index is not masked as a person in an answer; a person still is (Nov 22)', async () => {
    const mail = rec({ id: 'gmail:club', from: 'Clubdesk <noreply@clubdesk.example>', title: 'A payment did not go through', text: 'Your payment to Lumora did not go through. Ask Dana Okafor at the desk.' });
    const found: KnownEntity[] = [{ text: 'Lumora', type: 'name', by: 'nano' }, { text: 'Dana Okafor', type: 'name', by: 'nano' }];
    const q = 'What was my most recent Clubdesk email about?';
    const masked = await buildStepOption('answer', { answer: 'Dana Okafor wrote that your payment to Lumora did not go through.' }, mail, 'own', opts(q, { extraEntities: found }));
    expect(masked.text).toBe('[name 1] wrote that your payment to [name 2] did not go through.');
    const kept = await buildStepOption('answer', { answer: 'Dana Okafor wrote that your payment to Lumora did not go through.' }, mail, 'own', opts(q, { extraEntities: found, knownOrgs: new Set(['lumora']) }));
    expect(kept.text).toBe('[name] wrote that your payment to Lumora did not go through.');
  });

  it('"N3stra" stays in the answer; the AWS account ID is still masked', async () => {
    const z = rec({ id: 'gmail:z', from: 'N3stra Alerts <alerts@n3stra-mail.example>', title: 'Picks for you', text: 'N3stra found 3 new picks for you.' });
    const found: KnownEntity[] = [{ text: 'N3stra', type: 'other', by: 'nano' }];
    const o = await buildStepOption('answer', { answer: 'N3stra found 3 new picks for you.' }, z, 'own', opts('What did the alert say?', { extraEntities: found }));
    expect(o.text).toBe('N3stra found 3 new picks for you.');
    const id = await buildStepOption('answer', { answer: 'Your AWS account ID is 123456789012.' }, AWS, 'own', opts('What is my AWS account number?', { extraEntities: [{ text: '123456789012', type: 'other', by: 'nano' }] }));
    expect(id.text).toBe('Your AWS account ID is [id number].');
    const sender = rec({ id: 'gmail:s', from: 'Notes <notes@example.com>', title: 'Weekly', text: 'Studio2024 has a new class.' });
    const kept = await buildStepOption('answer', { answer: 'Studio2024 has a new class.' }, sender, 'own', opts('What did the weekly note say?', { extraEntities: [{ text: 'Studio2024', type: 'other', by: 'nano' }], knownSenders: new Set(['studio2024']) }));
    expect(kept.text).toBe('Studio2024 has a new class.');
  });
});

describe('the sensitive-topic detector (11 section 11.5)', () => {
  it('B15: background checks and screening, legal, medical details, HR matters and immigration status', () => {
    expect(sensitiveTopicOf('Checkr <no-reply@checkr.com>')).toBe('screening');
    for (const t of ['Your HireRight report is ready', 'Schedule your drug test', 'The background check is complete']) expect(sensitiveTopicOf(t), t).toBe('screening');
    for (const t of ['Your court date is set', 'a lawsuit was filed', 'Your attorney called', 'You received a subpoena']) expect(sensitiveTopicOf(t), t).toBe('legal');
    for (const t of ['Your diagnosis', 'Your prescription is ready', 'Your therapy session moved']) expect(sensitiveTopicOf(t), t).toBe('medical');
    for (const t of ['Your PIP starts Monday', 'an investigation into the complaint', 'Termination of employment']) expect(sensitiveTopicOf(t), t).toBe('hr');
    for (const t of ['Your visa status changed', 'Your I-94 record', 'A USCIS case update']) expect(sensitiveTopicOf(t), t).toBe('immigration');
    expect(itemTouchesSensitiveTopic(CHECKR)).toBe(true);
  });

  it('misses the look-alikes', () => {
    for (const t of ['Your Visa card ending 4417 was charged $12.', 'Meet at the food court at noon.', 'The tennis court is booked.', 'pip install sieve', 'Your lease ends in June.', 'Your order of Echo Dot has shipped.']) {
      expect(touchesSensitiveTopic(t), t).toBe(false);
    }
    expect(itemTouchesSensitiveTopic(AMAZON)).toBe(false);
  });
});
