import { describe, expect, it } from 'vitest';
import { repairLongNumbers } from './askedNumbers';

describe('repairLongNumbers', () => {
  const item = 'Thank you for applying. Job 310774205 at Lumora: we are moving forward with other candidates. Reference 88213377.';
  const asked = ['310774205', 'What is the status of my application for job number 310774205?'];

  it('writes the asked number back when the answer has it a digit off', () => {
    expect(repairLongNumbers('Your application for job number 31077205 was not selected.', asked, item)).toBe('Your application for job number 310774205 was not selected.');   // a digit dropped
    expect(repairLongNumbers('Your application for job 3107742205 was not selected.', asked, item)).toBe('Your application for job 310774205 was not selected.');             // a digit doubled
    expect(repairLongNumbers('Job 310774250 was not selected.', asked, item)).toBe('Job 310774205 was not selected.');                                                         // two digits swapped
  });

  it('leaves alone what is right, what the item holds, and what is not near', () => {
    expect(repairLongNumbers('Job 310774205 was not selected.', asked, item)).toBe('Job 310774205 was not selected.');
    expect(repairLongNumbers('The reference is 88213377.', asked, item)).toBe('The reference is 88213377.');             // another real number of the item
    expect(repairLongNumbers('Call 5550142000 about it.', asked, item)).toBe('Call 5550142000 about it.');               // far from the asked number
    expect(repairLongNumbers('It was 2026 when 31077 applied.', asked, item)).toBe('It was 2026 when 31077 applied.');   // too short to be a miscopy of it
  });

  it('repairs a miscopy of a long number of the item too, when the question gave none', () => {
    const receipt = 'Booking confirmed. Your confirmation number is 3394768281. Departure: Gate 5.';
    expect(repairLongNumbers('Your confirmation number is 339476281.', ['What is my confirmation number?'], receipt)).toBe('Your confirmation number is 3394768281.');
    expect(repairLongNumbers('Your confirmation number is 3394768281.', ['What is my confirmation number?'], receipt)).toBe('Your confirmation number is 3394768281.');
  });

  it('does nothing without a long number to compare with, or when two numbers are equally near', () => {
    expect(repairLongNumbers('Order 12345 shipped.', ['When did my order ship?'], 'Order 12346 shipped.')).toBe('Order 12345 shipped.');
    expect(repairLongNumbers('Booking 1000002 is confirmed.', ['1000001', '1000003'], 'Your booking is confirmed.')).toBe('Booking 1000002 is confirmed.');
  });
});
