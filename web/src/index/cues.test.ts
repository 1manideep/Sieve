// 20 sections 9.4 and 10.2: the sender, latest and count cues, and sender matching.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asksCount, asksLatest, asksState, holdsTopic, identifierTerms, isRoleCue, knownSenderWords, senderCue, senderMatches, topicTerms } from './cues';
import { loadDictionaryText } from './dictionary';

beforeAll(() => {
  loadDictionaryText(readFileSync(join(process.cwd(), 'web/src/index/dict/en-words.tsv'), 'utf8'));
});

describe('senderMatches', () => {
  it('compares the cue with the display name, the local part and the domain, word by word', () => {
    expect(senderMatches('Amazon', 'auto-confirm@amazon.com')).toBe(true);
    expect(senderMatches('Amazon', 'Amazon.in <order-update@amazon.in>')).toBe(true);
    expect(senderMatches('Kay', 'Kay Narayanan <kay.n@gmail.com>')).toBe(true);
    expect(senderMatches('kay narayanan', 'Kay Narayanan <kay.n@gmail.com>')).toBe(true);
    expect(senderMatches('Good Dog', 'Bookings <hello@gooddog.example>')).toBe(true);
    expect(senderMatches('GitHub', 'GitHub <noreply@github.com>')).toBe(true);
    expect(senderMatches('Strava', 'Strava <no-reply@strava.com>')).toBe(true);
    expect(senderMatches('Ramki', 'Ramakrishna Iyer <ramki@inbox.example>')).toBe(true);
    // the fuzzy rule for words of 5 or more letters
    expect(senderMatches('Gymshrk', 'Gymshark <hello@gymshark.com>')).toBe(true);
  });

  it('a sender that does not fit fails', () => {
    expect(senderMatches('Google', 'Zillow <no-reply@zillow.com>')).toBe(false);
    expect(senderMatches('Strava', 'Kay Narayanan <kay.n@gmail.com>')).toBe(false);
    expect(senderMatches('HelloSign', 'Dropbox Sign <noreply@mail.hellosign.com>')).toBe(true);
    expect(senderMatches('Kay Narayanan', 'Kay Smith <kay@x.example>')).toBe(false);
    expect(senderMatches('Kay', undefined)).toBe(false);
    // an address with no display name: the name sits inside the part before the @ (Nov 22)
    expect(senderMatches('The Quarry', 'thequarryuiuc@relay.example')).toBe(true);
    expect(senderMatches('Maple Court', 'themaplecourtapts@relay.example')).toBe(true);
    expect(senderMatches('Chase', 'purchases@store.example')).toBe(false);   // five letters inside another word is not a name
  });

  it('an address cue must be the address or its domain', () => {
    expect(senderMatches('dr.patel@clinic.example', 'Clinic <dr.patel@clinic.example>')).toBe(true);
    expect(senderMatches('dr.patel@clinic.example', 'Front desk <desk@clinic.example>')).toBe(true);
    expect(senderMatches('dr.patel@clinic.example', 'Other <a@other.example>')).toBe(false);
  });

  it('role words are never filters', () => {
    expect(isRoleCue('my landlord')).toBe(true);
    expect(isRoleCue('the bank')).toBe(true);
    expect(isRoleCue('Delta')).toBe(false);
  });
});

describe('senderCue', () => {
  let known: Set<string>;
  beforeAll(() => {
    known = knownSenderWords(['Strava <no-reply@strava.com>', 'Kestrelmoor Bank <alerts@kestrelmoor.example>', 'Parcelmoor Delivery <notice@parcelmoor-delivery.example>']);
  });

  it('finds the sender the tester named (T05, T06, T07, T10, T04)', () => {
    expect(senderCue('Did HelloSign send me a document to sign?')).toBe('HelloSign');
    expect(senderCue('When did my latest Gymshark order ship?')).toBe('Gymshark');
    expect(senderCue('Show me my Google verification emails')).toBe('Google');
    expect(senderCue("What did Ramki's latest email say?")).toBe('Ramki');
    expect(senderCue('What was my latest GitHub email about?')).toBe('GitHub');
    expect(senderCue('What did Kay say about the lease?')).toBe('Kay');
    expect(senderCue('emails from Dana in October')).toBe('Dana');
    expect(senderCue('Anything from Amazon.in this week?')).toBe('Amazon.in');
    expect(senderCue('what did strava say about my run', known)).toBe('strava');
  });

  it('leaves places, roles, plain words and title case alone', () => {
    for (const q of [
      'When does my flight from Seattle leave?',
      'What did my landlord say about the deposit?',
      "What's my latest bank balance?",
      'When does my flight to Seattle leave?',
      'Where is order #88231?',
      'Find the photo where I had five hot dogs in my mouth',
      'What does the parcel delivery email want?',
      'What Did My Landlord Say About The Deposit?',
      'What did they say?',
      'my December statement',
      'Can I have a dog, and is there a fee?',
      'What did my landlord say about the deposit? Draft a reply.',
    ]) {
      expect(senderCue(q, known), q).toBeUndefined();
    }
  });

  it('known sender words are not English words and not generic', () => {
    expect([...known].sort()).toEqual(['kestrelmoor', 'kestrelmoorbank', 'parcelmoor', 'parcelmoordelivery', 'strava']);
  });
});

describe('topicTerms and holdsTopic', () => {
  it("the question's own words, without stop words and \"latest\"", () => {
    expect(topicTerms('What did the most recent email about my Dashbite payment plan say?')).toEqual(['dashbite', 'payment', 'plan']);
    expect(topicTerms("What's the latest email from my bank?")).toEqual(['bank']);
  });

  it('an item is about the thing when its title or sender holds two of those words', () => {
    const topic = topicTerms('the most recent email about my Dashbite payment plan');
    expect(holdsTopic(topic, 'Payment failed for Dashbite', 'Klaro <noreply@klaro.example>')).toBe(true);
    expect(holdsTopic(topic, 'Your payments are up to date', 'Dashbite <no-reply@dashbite.example>')).toBe(true);   // the sender counts, and "payments" is "payment"
    expect(holdsTopic(topic, 'Long time no shop. Save 50%', 'Dashbite <no-reply@dashbite.example>')).toBe(false);
    expect(holdsTopic(topic, 'Refund confirmation for Dashbite', 'Klaro <noreply@klaro.example>')).toBe(false);
    expect(holdsTopic(topicTerms('my latest bank email'), 'Bank statement from your bank', 'Bank <a@bank.example>')).toBe(false);   // one word of its own
  });
});

describe('asksLatest and asksCount', () => {
  it('latest, newest, most recent, and last not followed by a unit', () => {
    for (const q of ["What's my latest bank balance?", 'the newest GitHub email', 'my most recent order', 'When did I last see the dentist?', "Ramki's last email"]) {
      expect(asksLatest(q), q).toBe(true);
    }
    for (const q of ['What did Kay say last week?', 'the last day of my lease', 'my last two receipts', 'What is her last name?', 'last Friday']) {
      expect(asksLatest(q), q).toBe(false);
    }
  });

  it('counts of items, not amounts inside one item', () => {
    for (const q of ['How many Strava emails did I get this month?', 'how many times did Kay email me', 'the number of orders from Amazon', 'Count my receipts from Uber', 'How often does Ramki email me?', 'how many runs did Strava log in October']) {
      expect(asksCount(q), q).toBe(true);
    }
    for (const q of ['How many days of leave do I have left?', 'How much was my deposit?', 'How many times a day should I take it?', 'What did my landlord say about the deposit?']) {
      expect(asksCount(q), q).toBe(false);
    }
  });
});

describe('identifiers and state questions', () => {
  it('finds order, booking and receipt numbers, in the terms and in the question', () => {
    expect(identifierTerms('Where does Lakeline booking 4471902288 depart from?', undefined)).toEqual(['4471902288']);
    expect(identifierTerms('How much was charged on receipt 5521-0098?', ['5521-0098'])).toEqual(['5521-0098']);
    expect(identifierTerms('What is the status of order #US20418833?', ['US20418833'])).toEqual(['us20418833']);
  });

  it('never takes a date, a time, an amount or a short number for an identifier', () => {
    expect(identifierTerms('What did I pay on 2026-11-01 at 10:30, was it $1,150.00 or 1150?', undefined)).toEqual([]);
    expect(identifierTerms('What happened on 11/04/2026 in room 204?', ['Kestrelmoor'])).toEqual([]);
  });

  it('knows a question about how a thing stands now', () => {
    expect(asksState('What is the status of order US20418833?')).toBe(true);
    expect(asksState('Has order US20418833 shipped yet?')).toBe(true);
    expect(asksState('How much was order US20418833?')).toBe(false);
  });
});
