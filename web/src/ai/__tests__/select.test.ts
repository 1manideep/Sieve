import { beforeEach, describe, expect, it } from 'vitest';
import { NANO_PROMPT_BUDGET } from '@sieve/shared';
import { estimatePromptTokens } from '../budget';
import { SELECT_TARGET_TOKENS, TIMING } from '../config';
import { setLanguageModelForTests } from '../device/languageModel';
import { setHybridForTests } from '../hybrid';
import { SELECT_SCHEMA, SELECT_SYSTEM } from '../prompts';
import { deriveExcerpt, fitPassages, selectAndAnswer, selectPrompt } from '../tasks/select';
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

  it('SE-9: seven 5,000-character records with chunks all fit, widened only up to the soft target', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      record({ id: `playground:r${i}`, title: `Item ${i}`, text: `Sentence number ${i} is here and it says something. `.repeat(100).slice(0, 5000) }),
    );
    const ranges = Object.fromEntries(records.map((r) => [r.id, { start: 1000, end: 1200 }]));
    const passages = fitPassages('something', records, ranges, { today: TODAY });
    expect(passages).toHaveLength(7);
    for (const p of passages) expect(p.range.start).toBeLessThanOrEqual(1000);
    expect(estimate(selectPrompt('something', passages, { today: TODAY }))).toBeLessThan(SELECT_TARGET_TOKENS);
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
