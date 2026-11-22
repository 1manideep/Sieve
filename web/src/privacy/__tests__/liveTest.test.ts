// The Nov 21 live test, privacy side: JSON characters in a shared answer ("...21st.}]."), the asked-for date shared as
// [address], a station shared as [address], a booking number shared as [phone], and a job title with commas refused
// as several facts (11 sections 10.2 and 10.3a).
import type { IndexRecord, KnownEntity } from '@sieve/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPrivacyModelHost } from '../model/client';
import { clearScanMemo } from '../scan/scan';
import { keepAskerWords } from '../steps/asker';
import { hasList, leaksStructure, packsSeveralFacts } from '../steps/answerShape';
import { buildStepOption, UNAVAILABLE } from '../steps/build';
import { dropPublicValues, isDateOrTime, isLabelledReference, isStreetAddress } from '../steps/publicValues';
import { unmaskedNumber } from '../../robust/sendGuard';

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
    category: 'Travel', categoryBy: 'device', hiddenRemoved: [], pii: [], sizeBytes: over.text!.length, indexedAt: 0, contentHash: 'h', version: 1,
    ...over,
  };
}

async function answerOf(record: IndexRecord, answer: string, question: string, extra: { extraEntities?: KnownEntity[]; terms?: string[] } = {}) {
  return buildStepOption('answer', { answer }, record, 'own', { question, maxStep: 'answer', ...extra });
}
const nano = (text: string, type: KnownEntity['type']): KnownEntity => ({ text, type, by: 'nano' });

const PAY = rec({
  id: 'gmail:parcel', from: 'Bramblecroft Post <notices@bramblecroft.example>', title: 'Your delivery is scheduled', category: 'Shopping',
  text: 'Your delivery of 2 parcels from Fernvale Books is scheduled for today, November 21st.',
});
const HOTEL = rec({
  id: 'gmail:hotel', from: 'Quillmere Suites <stay@quillmere.example>', title: 'Your stay is confirmed',
  text: 'Check-in: Monday, September 21, 2026 from 3:00 PM. Check-out: Wednesday, September 23, 2026 by 11:00 AM. Quillmere Suites Brookfield, 48 Larkin Avenue, Brookfield.',
});
const BUS = rec({
  id: 'gmail:bus', from: 'Northline Coaches <tickets@northline.example>', title: 'Your Northline booking 5520018842 is confirmed',
  text: 'Booking Number: 5520018842\nDeparture Station Northline Bus Station, 07:15 AM\nWednesday, September 30, 2026\nQuestions? Call 617-555-0184.',
});
const ORDER = rec({
  id: 'gmail:order', from: 'Larkfield Goods <orders@larkfield.example>', title: 'We got your order', category: 'Shopping',
  text: 'Order #A10244871 is confirmed. Booking Number: 6175550184. Support: call (617) 555-0199 or text 6175550123.',
});

describe('Defect 1: structure from the model output never reaches an answer', () => {
  it('reads "}]", \'{"\', \'"}\', a key, a fence, and a bracket, brace, comma or unpaired quote at an end', () => {
    for (const t of [
      'It today, November 21st.}].',
      'Your delivery is today, November 21st."}',
      '{"item":"P1","answer":"Your delivery is today."}',
      'Your delivery is today", "item": "P1',
      '```json Your delivery is today.```',
      '] Your delivery is today.',
      'Your delivery is today.]',
      'Your delivery is today,',
      'Your delivery is today."',
      '"Your delivery is today.',
    ]) {
      expect(leaksStructure(t), t).toBe(true);
    }
    for (const t of [
      'Your delivery of 2 parcels is scheduled for today, November 21st.',
      '[name] sent the lease on March 3.',
      'Your check-in is on [address].',
      'The subject is "Your stay is confirmed".',
      '"Welcome aboard," the email says.',
      'Your 27" monitor ships Friday.',
      '[...] the deposit is due Friday (in full).',
      'Yes.',
    ]) {
      expect(leaksStructure(t), t).toBe(false);
    }
  });

  it('the outgoing answer is not offered when it still carries them; a clean one is', async () => {
    const bad = await answerOf(PAY, 'Your delivery of 2 parcels comes today, November 21st.}]', 'What was my most recent email from Bramblecroft about?');
    expect(bad).toMatchObject({ available: false, unavailableReason: UNAVAILABLE.badOutput });
    const good = await answerOf(PAY, 'Your delivery of 2 parcels comes today, November 21st.', 'What was my most recent email from Bramblecroft about?');
    expect(good).toMatchObject({ available: true, text: 'Your delivery of 2 parcels comes today, November 21st.' });
  });
});

describe('Defect 2: dates and times are never masked', () => {
  it('reads dates and times, and nothing else', () => {
    for (const t of ['Monday, September 21, 2026', 'September 21, 2026', 'Sep 21', 'Sept. 21', '21 September', '2026-09-21', '2026-09-21T15:00:00Z', '9/21/2026', '7:45 AM', '7:45 a.m.', '3 PM', '09:45 AM on Wednesday, September 30, 2026', 'Wednesday', 'noon']) {
      expect(isDateOrTime(t), t).toBe(true);
    }
    for (const t of ['48 Larkin Avenue', '1 May Street', 'Sunday Lane', 'Northline Bus Station', '5520018842', '617-555-0184', '2026', '7', 'Brookfield, IL']) {
      expect(isDateOrTime(t), t).toBe(false);
    }
  });

  it('the asked-for check-in date stays, though a detector called it an address; the street address is still masked', async () => {
    const q = 'What is the check-in date for my Quillmere stay?';
    const date = await answerOf(HOTEL, 'Your check-in is on Monday, September 21, 2026.', q, { extraEntities: [nano('Monday, September 21, 2026', 'address')] });
    expect(date).toMatchObject({ available: true, text: 'Your check-in is on Monday, September 21, 2026.', redactions: 0 });
    // a date with its time is no ID number either (the protected values of 5.7 read only a bare date or time)
    const when = 'Monday, September 21, 2026 at 3:00 PM';
    const time = await answerOf(HOTEL, `Check-in opens ${when}.`, 'When does check-in open?', { extraEntities: [nano(when, 'other')] });
    expect(time.text).toBe(`Check-in opens ${when}.`);
    const street = await answerOf(HOTEL, 'The hotel is at 48 Larkin Avenue, Brookfield.', 'Where is the hotel?', { extraEntities: [nano('48 Larkin Avenue', 'address')] });
    expect(street.text).toBe('The hotel is at [address], Brookfield.');
  });
});

describe('Defect 2: an address is masked only when it is a street address', () => {
  const at = (text: string, part: string) => {
    const i = text.indexOf(part);
    return isStreetAddress(text, i, i + part.length);
  };

  it('a house or unit number with a street word, a PO box or a postal code; not a station, a terminal, a gate, a hotel or a city', () => {
    const line = 'Keys at 1847 W Tamsin Ave, Apt 4B. Mail to PO Box 220. Office: Brookfield, IL 62704. Leave from Terminal 3, Gate 12.';
    expect(at(line, '1847 W Tamsin Ave')).toBe(true);
    expect(at(line, 'W Tamsin Ave')).toBe(true);                      // its house number stands just before it
    expect(at(line, 'Apt 4B')).toBe(true);
    expect(at(line, 'PO Box 220')).toBe(true);
    expect(at(line, 'Brookfield, IL 62704')).toBe(true);
    expect(at(line, 'Brookfield, IL')).toBe(false);
    expect(at(line, 'Terminal 3')).toBe(false);
    expect(at(line, 'Gate 12')).toBe(false);
    expect(at('Flat 3, 12 Rosebank Close', 'Flat 3')).toBe(true);
    expect(at('Flat 3, 12 Rosebank Close', '12 Rosebank Close')).toBe(true);
    expect(at('Departure Station Northline Bus Station, 07:15 AM', 'Northline Bus Station')).toBe(false);
    expect(at('Quillmere Suites Brookfield, 48 Larkin Avenue', 'Quillmere Suites Brookfield')).toBe(false);
    expect(at('She lives on Larkin Avenue now.', 'Larkin Avenue')).toBe(false);   // a street with no number
  });

  it('the asked-for station stays; the street address in the same answer is masked', async () => {
    const q = 'Which station does my Northline bus depart from?';
    const station = await answerOf(BUS, 'Your bus departs from Northline Bus Station at 07:15 AM on Wednesday, September 30, 2026.', q, {
      extraEntities: [nano('Northline Bus Station', 'address')],
    });
    expect(station).toMatchObject({ available: true, text: 'Your bus departs from Northline Bus Station at 07:15 AM on Wednesday, September 30, 2026.' });
    const hotel = await answerOf(HOTEL, 'Quillmere Suites Brookfield is at 48 Larkin Avenue, Brookfield.', 'Where is my hotel?', {
      extraEntities: [nano('Quillmere Suites Brookfield', 'address'), nano('48 Larkin Avenue', 'address')],
    });
    expect(hotel.text).toBe('Quillmere Suites Brookfield is at [address], Brookfield.');
  });
});

describe('Defect 2: a labelled reference number is not a phone or an ID number', () => {
  const ref = (text: string, value: string, item = '') => isLabelledReference(value, text, text.indexOf(value), item);

  it('a booking, order or confirmation label, or "#", makes it a reference; a phone cue or a phone shape keeps it a phone', () => {
    expect(ref('Booking Number: 6175550184', '6175550184')).toBe(true);
    expect(ref('Your booking number is 6175550184.', '6175550184')).toBe(true);
    expect(ref('Confirmation: 884213907', '884213907')).toBe(true);
    expect(ref('Order #A10244871 is confirmed.', 'A10244871')).toBe(true);
    expect(ref('Your number is 6175550184.', '6175550184', 'Booking Number: 6175550184')).toBe(true);   // labelled in the item
    expect(ref('Call 6175550184 for help.', '6175550184')).toBe(false);
    expect(ref('Booking line: call 6175550184.', '6175550184')).toBe(false);
    expect(ref('Booking: (617) 555-0184', '(617) 555-0184')).toBe(false);
    expect(ref('Booking: 617-555-0184', '617-555-0184')).toBe(false);
    expect(ref('Your number is 6175550184.', '6175550184', 'Booking Number: 6175550184. Or call 6175550184.')).toBe(false);
    expect(ref('Reach her at 6175550184.', '6175550184')).toBe(false);                                   // no label: a phone, as before
  });

  it('the asked-for booking number stays; the phone numbers next to it are masked', async () => {
    const booking = await answerOf(ORDER, 'Your booking number is 6175550184.', 'What is my booking number?');
    expect(booking).toMatchObject({ available: true, text: 'Your booking number is 6175550184.', redactions: 0 });
    const order = await answerOf(ORDER, 'Your order number is A10244871.', 'What is my order number?', { extraEntities: [nano('A10244871', 'other')] });
    expect(order.text).toBe('Your order number is A10244871.');
    const support = await answerOf(ORDER, 'Support is at (617) 555-0199 or 6175550123.', 'How do I reach support?');
    expect(support.text).toBe('Support is at [phone 1] or [phone 2].');
    const unlabelled = await answerOf(BUS, 'For questions, call 617-555-0184.', 'Who do I call with questions?');
    expect(unlabelled.text).toBe('For questions, call [phone].');
  });

  it('the full item keeps its booking number and masks its phone number', async () => {
    const full = await buildStepOption('full', { full: ORDER.text }, ORDER, 'own', { question: 'What is in my order email?' });
    expect(full.text).toContain('Booking Number: 6175550184.');
    expect(full.text).toContain('Order #A10244871');
    expect(full.text).toContain('Support: call [phone 1] or text [phone 2].');
  });

  it('the send checks never stop an unmasked booking number', async () => {
    expect(await unmaskedNumber('Your booking number is 5520018842.', 'What is my booking number?')).toBeNull();
  });
});

describe('Defect 2: identifiers the caller gave stay unmasked', () => {
  it('a number in the request terms counts as typed, whatever its separators', async () => {
    const asked = await answerOf(ORDER, 'Booking 617 555 0184 leaves at 07:15 AM.', 'When does my bus leave?', { terms: ['6175550184'] });
    expect(asked.text).toBe('Booking 617 555 0184 leaves at 07:15 AM.');
    const notAsked = await answerOf(ORDER, 'Reach the desk at 617 555 0184.', 'How do I reach the desk?');
    expect(notAsked.text).toBe('Reach the desk at [phone].');
    const text = 'Call 6175550184 about your booking.';
    const spans = [{ start: 5, end: 15, type: 'phone' as const, by: 'validator' as const }];
    expect(keepAskerWords(text, spans, 'Where does booking 617-555-0184 leave from?')).toEqual([]);
    expect(keepAskerWords(text, spans, 'Where does my booking leave from?')).toEqual(spans);
  });

  it('one-time codes are still masked when the caller names them', () => {
    const text = 'Your code is 482913.';
    const code = [{ start: 13, end: 19, type: 'secret-code' as const, by: 'validator' as const }];
    expect(keepAskerWords(text, code, 'Is 482913 my code?')).toEqual(code);
  });

  it('the last check marking a whole sentence, an amount or a year does not mask the answer (Nov 22)', async () => {
    const PASS = rec({ id: 'gmail:pass-1', from: 'Marlin Transit <service@marlin.example>', title: 'Your pass credit is under $40.00 USD', text: 'Your pass credit is under $40.00 USD. Your automatic top-up did not go through. Member number 5520018842.' });
    const said = 'Your automatic top-up did not go through, and your pass credit is under $40.00 USD.';
    const q = 'What was my most recent Marlin email about?';
    const whole = await answerOf(PASS, said, q, { extraEntities: [nano(said, 'other'), nano('$40.00 USD', 'other'), nano('automatic top-up', 'other')] });
    expect(whole.available).toBe(true);
    expect(whole.text).not.toContain('[');
    const year = await answerOf(HOTEL, 'Your check-in is in 2026.', 'Which year is my check-in?', { extraEntities: [nano('2026', 'name')] });
    expect(year.text).toBe('Your check-in is in 2026.');
    // an answer that is only a mask says nothing, so it is not offered
    const masked = await answerOf(PASS, '5520018842.', 'What is in my Marlin email?', { extraEntities: [nano('5520018842', 'other')] });
    expect(masked.available).toBe(false);
    expect(masked.unavailableReason).toBe(UNAVAILABLE.empty);
  });

  it('a date that a detector marked as a name is not masked; a bare month that may be a person still is', () => {
    const text = 'Your check-in date is Sunday, September 20, 2026, from 3:00 PM. June will meet you there.';
    const date = text.indexOf('Sunday');
    const june = text.indexOf('June');
    const spans = [
      { type: 'name' as const, start: date, end: date + 'Sunday, September 20, 2026'.length, by: 'validator' as const },
      { type: 'name' as const, start: june, end: june + 4, by: 'validator' as const },
    ];
    expect(dropPublicValues(text, spans, text)).toEqual([spans[1]]);
  });

  it('dropPublicValues leaves names (even "June"), dates of birth and cards alone', () => {
    const text = 'June was born on May 3, 1990 and paid with 4111 1111 1111 1111.';
    const span = (part: string, type: 'name' | 'dob' | 'card') => ({ start: text.indexOf(part), end: text.indexOf(part) + part.length, type, by: 'validator' as const });
    const spans = [span('June', 'name'), span('May 3, 1990', 'dob'), span('4111 1111 1111 1111', 'card')];
    expect(dropPublicValues(text, spans, text)).toEqual(spans);
  });
});

describe('Defect 3: one phrase with commas is one fact', () => {
  it('a role, a title, a product or one thing with its parts', () => {
    for (const t of [
      'A Python, Django and GCP developer role.',
      'A Python, Django, GCP developer role.',
      'The recruiter is hiring for a Python, Django and GCP developer.',
      'They are hiring a Senior Python, Django, GCP Engineer.',
      'They are hiring for the Python, Django and GCP developer role.',
      'You ordered a red, green and blue scarf.',
      'It is a Monday, Wednesday and Friday class.',
    ]) {
      expect(hasList(t), t).toBe(false);
      expect(packsSeveralFacts(t), t).toBe(false);
    }
  });

  it('real lists are still several facts', () => {
    for (const t of [
      'Your last five emails are from Priya Shah, Dana Lee, Benji Kumar, Ivo Lindqvist and Larkfield.',
      'Your last emails are from the Lee, Shah and Ivo Lindqvist.',     // names after "the": a capital word after them
      'You paid $12, $40 and $7.',
      'You bought apples, pears and plums.',
      'The Python, Django and GCP roles are open.',
      'The Larkfield, Quillmere and Northline orders arrived Friday.',
      'They are hiring Python, Django and GCP developers.',
      'Your interview is Monday; your offer came Tuesday; your start date is December 1.',
      '1) a Python role 2) a GCP role',
    ]) {
      expect(packsSeveralFacts(t), t).toBe(true);
    }
  });

  it('the role answer is offered at the answer level', async () => {
    const job = rec({
      id: 'gmail:job', from: 'Fennick Talent <jobs@fennick.example>', title: 'Now hiring: senior platform engineer', category: 'Work',
      text: 'Hi, we are hiring for a Python, Django and GCP developer role on our platform team.',
    });
    const o = await answerOf(job, 'A Python, Django and GCP developer role.', 'What role is the Fennick recruiter hiring for?');
    expect(o).toMatchObject({ available: true, text: 'A Python, Django and GCP developer role.' });
  });
});
