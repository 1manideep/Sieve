// The Nov 21 live test, pipeline side, with the real privacy build: a booking email whose station and booking number
// were shared as [address] and [phone]. The asked-for facts stay readable; the passenger's name, street address and
// phone number are still masked in the full item (11 section 10.2, 10 section 12).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES } from '@sieve/shared';
import type { Proposal, QueryHints, Settings } from '@sieve/shared';
import { setLanguageModelForTests } from '@/ai/device/languageModel';
import { setHybridForTests } from '@/ai/hybrid';
import { createFakeHybrid, type FakeHybrid } from '@/ai/testing/fakeHybrid';
import { installFakeLanguageModel } from '@/ai/testing/fakeLanguageModel';
import { resetAiForTests } from '@/ai/testing/reset';
import { fakeDb } from '@/ai/__tests__/fakeDb';
import { record } from '@/ai/__tests__/fixtures';
import { setPrivacyModelHost } from '@/privacy/model/client';
import { clearScanMemo } from '@/privacy/scan/scan';
import { prepareProposal } from '../prepareProposal';
import type { PrepareInput } from '../types';
import * as idx from './mocks/index';

vi.mock('@/index', () => import('./mocks/index'));

const SETTINGS: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
const OUTSIDE = { kind: 'outside' as const, grantId: 'g1', aiName: 'Claude' };
const T = new Date(2026, 10, 18, 9, 0).getTime();

const BUS = record({
  id: 'gmail:northline', source: 'gmail', title: 'Your Northline booking 5520018842 is confirmed', from: 'Northline Coaches <tickets@northline.example>',
  category: 'Travel', date: T - 86_400_000,
  text: [
    'Booking Number: 5520018842',
    'Departure Station Northline Bus Station, 07:15 AM',
    'Wednesday, September 30, 2026',
    'Passenger: Dana Okafor',
    'Billing address: 214 Calder Street, Fernvale',
    'Questions? Call 617-555-0184.',
  ].join('\n'),
});

/** What the share-time Gemini Nano check found in the live test, plus two details that are personal. */
const NANO_FOUND = [
  { text: 'Northline Bus Station', type: 'address' },
  { text: '5520018842', type: 'id' },
  { text: 'Dana Okafor', type: 'name' },
  { text: '214 Calder Street', type: 'address' },
];

let hybrid: FakeHybrid;

function model(answer: string) {
  hybrid = createFakeHybrid((spec, parts) => {
    const prompt = parts.map((p) => ('text' in p ? p.text : '')).join('\n');
    if (spec.purpose === 'verify-answer') return { text: JSON.stringify({ answers: true, reason: 'The passage states it.' }), source: 'on_device' };
    if (spec.purpose === 'injection-check') return { text: JSON.stringify({ suspicious: false, quote: '' }), source: 'on_device' };
    if (spec.purpose === 'pii-check') return { text: JSON.stringify({ items: NANO_FOUND.filter((f) => prompt.includes(f.text)) }), source: 'on_device' };
    return { text: JSON.stringify({ item: 'P1', answer }), source: 'on_device' };
  });
  setHybridForTests(hybrid);
}

function input(question: string, hints?: QueryHints): PrepareInput {
  return {
    db: fakeDb(), requestId: 'r1', question, requester: OUTSIDE, requestedStep: 'answer', maxStep: 'full', settings: SETTINGS, dataClass: 'own',
    allowedSources: ['gmail'], ...(hints ? { hints } : {}),
  };
}

const option = (p: Proposal, step: 'answer' | 'full') => p.options.find((o) => o.step === step)!;

beforeEach(() => {
  resetAiForTests();
  clearScanMemo();
  setPrivacyModelHost(null);
  idx.resetIndexMock([BUS]);
  idx.search.mockResolvedValue([idx.cand(BUS.id)]);
  setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
});

describe('the live test (Nov 21): a booking email', () => {
  it('"Where does booking 5520018842 depart from?" with the number in the terms: ready, station and number readable', async () => {
    model('Booking 5520018842 departs from Northline Bus Station at 07:15 AM.');
    const p = await prepareProposal(input('Where does booking 5520018842 depart from?', { terms: ['5520018842'] }));
    expect(p.outcome).toBe('ready');
    expect(option(p, 'answer')).toMatchObject({ available: true, text: 'Booking 5520018842 departs from Northline Bus Station at 07:15 AM.', redactions: 0 });
    expect(hybrid.callsFor('pii-check').length).toBeGreaterThan(0);
  });

  it('"What is my booking number?": ready, the number readable', async () => {
    model('Your booking number is 5520018842.');
    const p = await prepareProposal(input('What is my booking number?'));
    expect(p.outcome).toBe('ready');
    expect(option(p, 'answer')).toMatchObject({ available: true, text: 'Your booking number is 5520018842.', redactions: 0 });
  });

  it('the full item keeps the booking number and the station, masks the name, the street address and the phone, and says so', async () => {
    model('Your booking number is 5520018842.');
    const p = await prepareProposal(input('What is my booking number?'));
    const full = option(p, 'full');
    expect(full.available).toBe(true);
    for (const kept of ['Booking Number: 5520018842', 'Departure Station Northline Bus Station, 07:15 AM', 'Wednesday, September 30, 2026']) expect(full.text).toContain(kept);
    for (const masked of ['Passenger: [name]', 'Billing address: [address], Fernvale', 'Call [phone].']) expect(full.text).toContain(masked);
    for (const gone of ['Dana Okafor', '214 Calder Street', '617-555-0184']) expect(full.text).not.toContain(gone);
    expect(p.warnings.map((w) => w.kind)).toContain('pii-redacted');
  });

  it('a number the caller gave only in the terms stays in the answer; without it, a phone number is masked', async () => {
    model('Call 617-555-0184 about your booking.');
    const p = await prepareProposal(input('Which number do I call about my Northline booking?', { terms: ['6175550184'] }));
    expect(option(p, 'answer').text).toBe('Call 617-555-0184 about your booking.');
    const unasked = await prepareProposal(input('Which number do I call about my Northline booking?'));
    expect(option(unasked, 'answer').text).toBe('Call [phone] about your booking.');
  });
});
