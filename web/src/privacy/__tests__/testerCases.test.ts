// The Nov 20 tester's privacy cases on small fixtures: T10 (a one-time code left the device), T04 (the caller's own
// "1manideep" masked as [id number]), T05 (a third person's name left the device), T02 and "Ivo" (words the asker typed).
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

const T10 = 'Your Nestra verification code is 733211. It expires in 10 minutes. If you did not ask for it, you can ignore this email.';

describe('one-time codes and sign-in links (secret-code, T10)', () => {
  it('finds the codes and the links', () => {
    const at = (t: string) => findSecretCodes(t).map((s) => t.slice(s.start, s.end));
    expect(at(T10)).toEqual(['733211']);
    expect(at('G-482913 is your Google verification code.')).toEqual(['G-482913']);
    expect(at('Use 4821 to sign in. Do not share it.')).toEqual(['4821']);
    expect(at('Your one-time passcode: 551 902')).toEqual(['551 902']);
    expect(at('Confirm your email with code K7Q2LM9.')).toEqual(['K7Q2LM9']);
    expect(at('Sign in: https://www.nestra.example/user/verify?token=abc123 (expires soon)')).toEqual(['https://www.nestra.example/user/verify?token=abc123']);
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
    const nestra = rec({ id: 'gmail:nestra', from: 'Nestra <no-reply@nestra.example>', text: T10, title: 'Sign in to Nestra' });
    expect(holdsSecretCode(nestra)).toBe(true);
    expect(await answer(nestra, 'Your Nestra verification code is 733211.', 'Show me my Google verification emails')).toBe('Your Nestra verification code is [code].');
    expect(await answer(nestra, 'Your Nestra verification code is 733211.', 'What is 733211 for?')).toBe('Your Nestra verification code is [code].');
    expect(await answer(nestra, 'Yes, your Nestra verification code is 733211.', 'Is 733211 my Nestra code?')).toBe('Yes.');
    // the same when the subject holds the same words: the words stay (they are the answer's own), the code never does
    const subject = { ...nestra, title: 'Your Nestra verification code' };
    const o = await buildStepOption('answer', { answer: 'Your Nestra verification code is 733211.' }, subject, 'own', { question: 'What is 733211 for?', maxStep: 'answer' });
    expect(o).toMatchObject({ available: true, text: 'Your Nestra verification code is [code].' });
  });
});

describe('a hyphen in a personal detail (Nov 21, 2026: the masking threw a SyntaxError on every one)', () => {
  it('masks a hyphenated name, a dashed phone number and a dashed reference without throwing', async () => {
    const shop = rec({ id: 'gmail:shop', from: 'Tindle Store <orders@tindle.example>', text: 'Hi Anne-Marie Delacroix, call us at 312-555-0142 about reference 4471-2209.' });
    const found: KnownEntity[] = [
      { text: 'Anne-Marie Delacroix', type: 'name', by: 'nano' },
      { text: '312-555-0142', type: 'phone', by: 'nano' },
      { text: '4471-2209', type: 'other', by: 'nano' },
    ];
    const out = await answer(shop, 'Anne-Marie Delacroix can be reached at 312-555-0142 about 4471-2209.', 'What does the email say about my order?', found);
    expect(out).not.toContain('Anne-Marie');
    expect(out).not.toContain('312-555-0142');
    // the asker's own reference stays readable
    const asked = await answer(shop, 'Reference 4471-2209 is about your order.', 'What is reference 4471-2209 about?', found);
    expect(asked).toContain('4471-2209');
  });

  it('escapeRegExp output is valid with and without the u flag for every punctuation mark', async () => {
    const { escapeRegExp } = await import('../text');
    const marks = '.*+?^${}()|[]\\/-#&,:;=@_~\'"!%<>';
    for (const flags of ['', 'u', 'giu']) expect(() => new RegExp(escapeRegExp(`a${marks}b 5521-0098`), flags)).not.toThrow();
    expect(new RegExp(`^${escapeRegExp(marks)}$`, 'u').test(marks)).toBe(true);
  });
});

describe('names and the words the asker typed (T02, T04, T05)', () => {
  it('T04: "1manideep" from the question is never masked; another person stays masked', async () => {
    const gh = rec({ id: 'gmail:gh', from: 'GitHub <noreply@github.com>', text: 'Hi 1manideep, a new release of 1manideep/Sieve was published by Benji Kumar.' });
    const found: KnownEntity[] = [{ text: '1manideep', type: 'other', by: 'nano' }, { text: 'Benji Kumar', type: 'name', by: 'nano' }];
    const text = 'Benji Kumar published a new release of 1manideep/Sieve.';
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

  it('"Ivo" from the question stays; the rest of the name is masked, the same way each time', async () => {
    const ivo = rec({ id: 'gmail:ivo', from: 'Ivo Lindqvist <ivo.lindqvist@gmail.com>', text: 'The lease starts on June 1.' });
    expect(await answer(ivo, 'Ivo Lindqvist said the lease starts on June 1.', 'What did Ivo say about the lease?')).toBe('Ivo [name] said the lease starts on June 1.');
    expect(await answer(ivo, 'Ivo Lindqvist said the lease starts on June 1.', 'What did Ivo Lindqvist say about the lease?')).toBe('Ivo Lindqvist said the lease starts on June 1.');
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
    const text = 'Ivo Lindqvist said the lease starts on June 1.';
    const ivo = [{ start: 0, end: 13, type: 'name' as const, by: 'validator' as const }];
    expect(keepAskerWords(text, ivo, 'What did Ivo say?').map((s) => text.slice(s.start, s.end))).toEqual(['Lindqvist']);
    expect(keepAskerWords(text, ivo, "Ivo's lease: when does it start?").map((s) => text.slice(s.start, s.end))).toEqual(['Lindqvist']);
  });

  it('a company sender in the same phrasing is not a person', async () => {
    const dog = rec({ id: 'gmail:dog2', from: 'Sunny Paws <hello@sunnypaws.example>', text: 'Your booking for Bella is confirmed.' });
    expect(await answer(dog, 'Sunny Paws sent you a booking confirmation for Jun 10.', 'What did the daycare send about the booking?')).toBe('Sunny Paws sent you a booking confirmation for Jun 10.');
  });

  it("T02: the dog's name the asker typed is not masked", async () => {
    const dog = rec({ id: 'gmail:dog', from: 'Sunny Paws Daycare <hello@sunnypaws.example>', text: 'Pickup Jun 12 at 5 PM for Bella.' });
    const found: KnownEntity[] = [{ text: 'Bella', type: 'name', by: 'nano' }];
    expect(await answer(dog, "Bella's pickup is on Jun 12 at 5 PM.", "When is Bella's pickup?", found)).toBe("Bella's pickup is on Jun 12 at 5 PM.");
    expect(await answer(dog, "Bella's pickup is on Jun 12 at 5 PM.", 'When is the daycare pickup?', found)).toBe("[name]'s pickup is on Jun 12 at 5 PM.");
  });

  it('a person sender is told from a company sender', () => {
    expect(personSender('Priya Shah <priya.shah@gmail.com>')).toBe('Priya Shah');
    expect(personSender('Dana Whitfield <dana@thistlewick-pm.example>')).toBe('Dana Whitfield');
    expect(personSender('Ivo <ivo@gmail.com>')).toBe('Ivo');
    for (const f of ['Strava <no-reply@strava.com>', 'Kestrelmoor Bank <alerts@kestrelmoor.example>', 'Albatrine Air <bookings@albatrine.example>', 'Sunny Paws Daycare <hello@sunnypaws.example>', 'Code Review Bot <noreply@code.example>', 'auto-confirm@amazon.in']) {
      expect(personSender(f), f).toBeNull();
    }
  });
});
