// Share-time span filters (11 section 10.2 step 6, after the Nov 21 live tests): what a detector marked that is not a
// personal detail, so the asked-for fact stays readable. A date or a time is never masked (a date of birth aside); a
// number the text labels as a booking, order or other reference is not a phone or an ID number; an address is masked
// only when it is a street address. Names, cards, accounts, SSNs, email addresses and one-time codes are not touched.
import type { PiiSpan } from '@sieve/shared';
import { escapeRegExp } from '../text';

// ---------- dates and times ----------

const WEEKDAY = 'mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday';
const MONTH = 'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december';
const MERIDIEM = 'am|pm|a\\.m\\.|p\\.m\\.';
/** A word that makes the value a date or a time: a weekday, a month, a numeric or ISO date, a clock time. */
const ANCHOR = new RegExp(
  `^(?:(?:${WEEKDAY}|${MONTH})\\.?|\\d{1,4}[/.-]\\d{1,2}(?:[/.-]\\d{1,4})?|\\d{4}-\\d{2}-\\d{2}t[\\d:.]+(?:z|[+-][\\d:]+)?|\\d{1,2}(?::\\d{2}){1,2}(?:${MERIDIEM})?|\\d{1,2}(?:${MERIDIEM})|${MERIDIEM}|noon|midnight)$`,
);
/** Words that may stand next to one: a day of the month, a year, joining words, a time zone. */
const ALONGSIDE = /^(?:\d{1,2}(?:st|nd|rd|th)?|(?:19|20)\d{2}|at|on|of|the|from|to|until|and|-|–|utc|gmt|[ecmp][sd]?t|bst|cet|cest|ist)$/;

/** "Monday, September 7, 2026", "Sep 7", "2026-09-07", "7:45 AM", "09:45 AM on Wednesday": only date and time words. */
export function isDateOrTime(value: string): boolean {
  let anchor = false;
  for (const raw of value.toLowerCase().split(/[\s,;]+/)) {
    const w = raw.replace(/^[("'“]+|[)"'”:]+$/g, '');
    if (!w) continue;
    const t = /^[ap]\.m\.$/.test(w) ? w : w.replace(/\.$/, '');
    if (ANCHOR.test(t)) anchor = true;
    else if (!ALONGSIDE.test(t)) return false;
  }
  return anchor;
}

// ---------- street addresses ----------

const STREET_WORDS =
  'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Circle|Cir|' +
  'Highway|Hwy|Square|Sq|Trail|Trl|Row|Close|Crescent|Grove|Gardens|Mews|Alley|Plaza';
/** A house number with a street word, a unit, or a PO box: the part of an address that is personal. */
const STREET_PART = new RegExp(
  `\\b\\d{1,6}[A-Za-z]?\\s+(?:[NSEW]\\.?\\s+)?(?:[\\p{L}'’.-]+\\s+){0,4}?(?:${STREET_WORDS}|${STREET_WORDS.toUpperCase()})\\b` +
    '|\\b(?:Apt|Apartment|Unit|Suite|Ste|Flat|APT|UNIT|SUITE|FLAT)\\.?\\s*#?\\s*\\d[\\w-]{0,5}|\\bP\\.?\\s?O\\.?\\s*Box\\s+\\d{1,6}\\b',
  'gu',
);
/** US and Indian codes, UK and Canadian postcodes. */
const POSTAL = /\b\d{5}(?:-\d{4})?\b|\b\d{6}\b|\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/u;

/**
 * The span is part of a street address: a street part overlaps it (a house number just before "Oak Street" counts),
 * or it holds a postal code. A station, a terminal, a gate, a hotel or a city and state is not one.
 */
export function isStreetAddress(text: string, start: number, end: number): boolean {
  if (POSTAL.test(text.slice(start, end))) return true;
  const from = Math.max(0, start - 16);
  for (const m of text.slice(from, Math.min(text.length, end + 16)).matchAll(STREET_PART)) {
    const a = from + m.index;
    if (a < end && a + m[0].length > start) return true;
  }
  return false;
}

// ---------- reference numbers ----------

const REFERENCE_LABEL = /\b(?:booking|order|confirmation|reservation|reference|ref|invoice|receipt|ticket|tracking|case|itinerary)(?:\s+(?:number|no\.?|num|code|id))?(?:\s+(?:is|was))?\s*[:#]?\s*$/i;
const PHONE_CUE = /\b(?:phone|tel|telephone|call|cell|mobile|fax|text|sms|whatsapp)\b|\+\s*$/i;
const PHONE_SHAPE = /^\+|\(\d{2,4}\)|^\d{3}[-.\s]\d{3}[-.\s]\d{4}$/;

/** Where the value occurs in `text`: digits may be written with spaces, dots, dashes or brackets between them. */
function occurrences(value: string, text: string): number[] {
  const chars = [...value.replace(/[^\p{L}\p{N}]/gu, '')];
  if (chars.length < 4) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${chars.map(escapeRegExp).join('[\\s.()-]{0,2}')}(?![\\p{L}\\p{N}])`, 'giu');
  return [...text.matchAll(re)].map((m) => m.index);
}

/** The line before `at`, up to 40 characters: the label of the value there. */
function labelBefore(text: string, at: number): string {
  const before = text.slice(Math.max(0, at - 40), at);
  return before.slice(before.lastIndexOf('\n') + 1);
}

/**
 * The text labels the value as a reference ("Booking Number: 5520018842", "Order #A10244871", "your booking number
 * is ...") where it stands or anywhere in the item, and never presents it as a phone ("call", "tel", "+1", "(312)",
 * 312-555-0142).
 */
export function isLabelledReference(value: string, text: string, at: number, itemText: string): boolean {
  const v = value.trim();
  if (PHONE_SHAPE.test(v)) return false;
  const sites = [{ text, at }, ...occurrences(v, itemText).map((i) => ({ text: itemText, at: i }))];
  let reference = v.startsWith('#');
  for (const site of sites) {
    const label = labelBefore(site.text, site.at);
    if (PHONE_CUE.test(label.slice(-30))) return false;
    if (REFERENCE_LABEL.test(label) || /#\s*$/.test(label)) reference = true;
  }
  return reference;
}

// ---------- all together ----------

/** The spans to mask, without the public values above. `itemText` is the item's own text, for the labels. */
export function dropPublicValues(text: string, spans: readonly PiiSpan[], itemText: string): PiiSpan[] {
  return spans.filter((s) => {
    const value = text.slice(s.start, s.end);
    if (s.type !== 'name' && s.type !== 'dob' && s.type !== 'secret-code' && isDateOrTime(value)) return false;
    if (s.type === 'address') return isStreetAddress(text, s.start, s.end);
    if (s.type === 'phone' || s.type === 'other') return !isLabelledReference(value, text, s.start, itemText);
    return true;
  });
}
