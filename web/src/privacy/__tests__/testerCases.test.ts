// The Nov 20 tester's privacy cases on small fixtures: T10 (a one-time code left the device), T04 (the caller's own
// "1manideep" masked as [id number]), T05 (a third person's name left the device), T02 and "Kay" (words the asker typed).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IndexRecord, KnownEntity } from '@sieve/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPrivacyModelHost } from '../model/client';
import { findSecretCodes, holdsSecretCode } from '../pii/validators/secretCode';
import { clearScanMemo } from '../scan/scan';
import { keepAskerWords, personSender } from '../steps/asker';
import { buildStepOption } from '../steps/build';

const ai = vi.hoisted(() => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));
vi.mock('../../ai', () => ai);

beforeEach(() => {
  clearScanMemo();
  setPrivacyModelHost(null);
  ai.getNanoAvailability.mockReset().mockResolvedValue({ text: 'unavailable', image: 'unavailable' });
});

function rec(over: Partial<IndexRecord> & Pick<IndexRecord, 'id' | 'from' | 'text'>): IndexRecord {
  return {
    source: 'gmail', sourceRef: over.id.split(':')[1]!, kind: 'email', title: 'An email', date: Date.UTC(2026, 10, 18), preview: over.text!.slice(0, 200),
    category: 'Personal', categoryBy: 'device', hiddenRemoved: [], pii: [], sizeBytes: over.text!.length, indexedAt: 0, contentHash: 'h', version: 1,
    ...over,
  };
}

async function answer(record: IndexRecord, text: string, question: string, extraEntities: KnownEntity[] = []): Promise<string> {
  const o = await buildStepOption('answer', { answer: text }, record, 'own', { question, maxStep: 'answer', extraEntities });
  expect(o.available, o.unavailableReason).toBe(true);
  return o.text;
}

const T10 = 'Your Zillow verification code is 733211. It expires in 10 minutes. If you did not ask for it, you can ignore this email.';

describe('one-time codes and sign-in links (secret-code, T10)', () => {
  it('finds the codes and the links', () => {
    const at = (t: string) => findSecretCodes(t).map((s) => t.slice(s.start, s.end));
    expect(at(T10)).toEqual(['733211']);
    expect(at('G-482913 is your Google verification code.')).toEqual(['G-482913']);
    expect(at('Use 4821 to sign in. Do not share it.')).toEqual(['4821']);
    expect(at('Your one-time passcode: 551 902')).toEqual(['551 902']);
    expect(at('Confirm your email with code K7Q2LM9.')).toEqual(['K7Q2LM9']);
    expect(at('Sign in: https://www.zillow.com/user/verify?token=abc123 (expires soon)')).toEqual(['https://www.zillow.com/user/verify?token=abc123']);
    expect(at('Reset it here: https://accounts.example.com/reset-password?t=xyz.')).toEqual(['https://accounts.example.com/reset-password?t=xyz']);
  });

  it('leaves booking references, account endings, orders, promo and zip codes, unsubscribe links and amounts alone', () => {
    for (const t of [
      'Booking reference: K7Q2LM. Flight 1432 departs Chicago on Friday.',
      'Your statement for checking account ending in 4417 is ready. Sign in to Kestrelmoor online banking to view it.',
      'Your order #88231 has shipped.',
      'Use promo code SAVE20 at checkout.',
      'The office is at zip code 60601.',
      'Confirmation number: GH-30417. Free cancellation until December 2.',
      'Unsubscribe: https://news.example.com/unsubscribe?token=abc123',
      'We received your security deposit of $1,200 on March 3.',
      'Review it in the code review tool before Friday. PR #212 changed 14 files.',
    ]) {
      expect(findSecretCodes(t), t).toEqual([]);
    }
  });

  it('flags no item of the Playground (emails, files, photos)', () => {
    const bundle = JSON.parse(readFileSync(join(process.cwd(), 'data/playground/seed-bundle.json'), 'utf8')) as { records: IndexRecord[] };
    expect(bundle.records.length).toBe(46);
    expect(bundle.records.filter((r) => holdsSecretCode(r)).map((r) => r.id)).toEqual([]);
  });

  it('the share-time redaction removes a code from any outgoing text, even one the asker typed', async () => {
    const zillow = rec({ id: 'gmail:zillow', from: 'Zillow <no-reply@zillow.com>', text: T10, title: 'Sign in to Zillow' });
    expect(holdsSecretCode(zillow)).toBe(true);
    expect(await answer(zillow, 'Your Zillow verification code is 733211.', 'Show me my Google verification emails')).toBe('Your Zillow verification code is [code].');
    expect(await answer(zillow, 'Your Zillow verification code is 733211.', 'What is 733211 for?')).toBe('Your Zillow verification code is [code].');
    expect(await answer(zillow, 'Yes, your Zillow verification code is 733211.', 'Is 733211 my Zillow code?')).toBe('Yes.');
    // the same when the subject holds the same words: the words stay (they are the answer's own), the code never does
    const subject = { ...zillow, title: 'Your Zillow verification code' };
    const o = await buildStepOption('answer', { answer: 'Your Zillow verification code is 733211.' }, subject, 'own', { question: 'What is 733211 for?', maxStep: 'answer' });
    expect(o).toMatchObject({ available: true, text: 'Your Zillow verification code is [code].' });
  });
});

describe('names and the words the asker typed (T02, T04, T05)', () => {
  it('T04: "1manideep" from the question is never masked; another person stays masked', async () => {
    const gh = rec({ id: 'gmail:gh', from: 'GitHub <noreply@github.com>', text: 'Hi 1manideep, a new release of 1manideep/Sieve was published by Ramki Kumar.' });
    const found: KnownEntity[] = [{ text: '1manideep', type: 'other', by: 'nano' }, { text: 'Ramki Kumar', type: 'name', by: 'nano' }];
    const text = 'Ramki Kumar published a new release of 1manideep/Sieve.';
    expect(await answer(gh, text, 'What did my latest GitHub email say about 1manideep/Sieve?', found)).toBe('[name] published a new release of 1manideep/Sieve.');
    // one digit is not an ID number (B09 of Nov 21): it stays even when the asker did not type it
    expect(await answer(gh, text, 'What did my latest GitHub email say?', found)).toBe('[name] published a new release of 1manideep/Sieve.');
  });

  it('T05: a third person in "sent you an email" is masked, by the sender rule and by the phrasing', async () => {
    const priya = rec({ id: 'gmail:priya', from: 'Priya Shah <priya.shah@gmail.com>', text: 'See you at the Saturday run at 7.' });
    expect(await answer(priya, "Priya Shah sent you an email about Saturday's run.", 'What did the run club say about Saturday?')).toBe("[name] sent you an email about Saturday's run.");
    expect(await answer(priya, 'Priya said the run starts at 7.', 'When does the Saturday run start?')).toBe('[name] said the run starts at 7.');
    const strava = rec({ id: 'gmail:strava', from: 'Strava <no-reply@strava.com>', text: 'Priya Shah gave you kudos.' });
    expect(await answer(strava, 'Priya Shah sent you kudos on Strava.', 'What did Strava send me?')).toBe('[name] sent you kudos on Strava.');
  });

  it('"Kay" from the question stays; the rest of the name is masked, the same way each time', async () => {
    const kay = rec({ id: 'gmail:kay', from: 'Kay Narayanan <kay.narayanan@gmail.com>', text: 'The lease starts on June 1.' });
    expect(await answer(kay, 'Kay Narayanan said the lease starts on June 1.', 'What did Kay say about the lease?')).toBe('Kay [name] said the lease starts on June 1.');
    expect(await answer(kay, 'Kay Narayanan said the lease starts on June 1.', 'What did Kay Narayanan say about the lease?')).toBe('Kay Narayanan said the lease starts on June 1.');
  });

  it('an ordinary word in the question that is also a first name does not unmask it', () => {
    const cases: [string, string, string][] = [
      ['Will Turner approved the refund.', 'Will Turner', 'Will I get my refund?'],
      ['Lease signed by May Chen on March 3.', 'May Chen', 'May I see what the lease says?'],
      ['Mark Lee sent the invoice.', 'Mark Lee', 'Did they mark the invoice as paid?'],
      ['Grace Park confirmed the rent.', 'Grace Park', 'Is there a grace period on the rent?'],
      ['June Park confirmed the rent.', 'June Park', 'What did the landlord say in June?'],
    ];
    for (const [text, name, question] of cases) {
      const start = text.indexOf(name);
      const spans = keepAskerWords(text, [{ start, end: start + name.length, type: 'name', by: 'validator' }], question);
      expect(spans.map((s) => text.slice(s.start, s.end)), question).toEqual([name]);
    }
    const text = 'Kay Narayanan said the lease starts on June 1.';
    const kay = [{ start: 0, end: 13, type: 'name' as const, by: 'validator' as const }];
    expect(keepAskerWords(text, kay, 'What did Kay say?').map((s) => text.slice(s.start, s.end))).toEqual(['Narayanan']);
    expect(keepAskerWords(text, kay, "Kay's lease: when does it start?").map((s) => text.slice(s.start, s.end))).toEqual(['Narayanan']);
  });

  it('a company sender in the same phrasing is not a person', async () => {
    const dog = rec({ id: 'gmail:dog2', from: 'Good Dog <hello@gooddog.example>', text: 'Your booking for Bella is confirmed.' });
    expect(await answer(dog, 'Good Dog sent you a booking confirmation for Jun 10.', 'What did the daycare send about the booking?')).toBe('Good Dog sent you a booking confirmation for Jun 10.');
  });

  it("T02: the dog's name the asker typed is not masked", async () => {
    const dog = rec({ id: 'gmail:dog', from: 'Good Dog Daycare <hello@gooddog.example>', text: 'Pickup Jun 12 at 5 PM for Bella.' });
    const found: KnownEntity[] = [{ text: 'Bella', type: 'name', by: 'nano' }];
    expect(await answer(dog, "Bella's pickup is on Jun 12 at 5 PM.", "When is Bella's pickup?", found)).toBe("Bella's pickup is on Jun 12 at 5 PM.");
    expect(await answer(dog, "Bella's pickup is on Jun 12 at 5 PM.", 'When is the daycare pickup?', found)).toBe("[name]'s pickup is on Jun 12 at 5 PM.");
  });

  it('a person sender is told from a company sender', () => {
    expect(personSender('Priya Shah <priya.shah@gmail.com>')).toBe('Priya Shah');
    expect(personSender('Dana Whitfield <dana@thistlewick-pm.example>')).toBe('Dana Whitfield');
    expect(personSender('Kay <kay@gmail.com>')).toBe('Kay');
    for (const f of ['Strava <no-reply@strava.com>', 'Kestrelmoor Bank <alerts@kestrelmoor.example>', 'Albatrine Air <bookings@albatrine.example>', 'Good Dog Daycare <hello@gooddog.example>', 'Code Review Bot <noreply@code.example>', 'auto-confirm@amazon.in']) {
      expect(personSender(f), f).toBeNull();
    }
  });
});
