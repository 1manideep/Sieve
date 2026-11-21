// The second real test (Nov 21), index side: B13 "local files only" was ignored (now a hard filter, 20 section 10.2),
// and B01 and B04 asked for several things at once (asksSeveral, 10 section 12.4).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { setMlClient } from '../ml/client';
import { seedPlayground } from '../playground/seed';
import { asksCount, asksSeveral, sourceCue } from './cues';
import { openDb, type SieveDb } from './db';
import { wipeDb } from './lifecycle';
import { parseQuestion } from './parseQuestion';
import { peekQueue } from './queue/ingestQueue';
import { hardFilterOf, kindFits, passesFilter, search, type SearchReport } from './search';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/playground/assets', async () => (await import('../../../tests/harness/dataset')).assetsModule);

process.env.TZ = 'America/Chicago';

describe('B01, B04: several things at once', () => {
  it('asks for several fields or items', () => {
    for (const q of [
      'What are my last five emails?',
      'List the subjects of my last emails',
      'Give me the subjects of my last emails',
      'Give me the amount, date, merchant, card and confirmation number of my last payment in one sentence.',
      'list all my Amazon orders',
      'What are all of my subscriptions?',
      'Show every email from Amazon',
      'Tell me the five fields of my last payment',
      'What is my AWS account ID and when did my free plan end?',
      'Summarise my 3 latest receipts',
    ]) {
      expect(asksSeveral(q), q).toBe(true);
    }
  });

  it('one thing is one thing', () => {
    for (const q of [
      'What did my landlord say about the deposit?',
      "What's on my packing list?",
      'How much do I pay every month for the gym?',
      'When is my flight to Denver, Colorado?',
      'Which is newer, the lease or the deposit email?',
      'Hi, Sieve, what is my deposit?',
      'What is the date and time of my flight?',
      'Did I get emails in the last 2 weeks from Checkr?',
      'What is the name of the newest local file?',
    ]) {
      expect(asksSeveral(q), q).toBe(false);
    }
    expect(asksCount('What are my last five emails?')).toBe(false);   // a list, not a count: still unsupported via asksSeveral
  });
});

describe('B13: "local files only" is a hard filter', () => {
  it('reads the cue, never a lone word', () => {
    expect(sourceCue('What is my AWS account ID? Local files only.')).toBe('files');
    expect(sourceCue('What is the name of the newest local file?')).toBe('files');
    expect(sourceCue('Find the lease in my files')).toBe('files');
    expect(sourceCue('Show me the cat from my photos')).toBe('photos');
    expect(sourceCue('Is there a receipt in my mail?')).toBe('mail');
    expect(sourceCue('What did the pdf say?')).toBeUndefined();
    expect(sourceCue('emails from Amazon')).toBeUndefined();
  });

  it('parseQuestion gives `only`, and the filter takes the request hint first, then the cue', () => {
    const p = parseQuestion('What is my AWS account ID? Local files only.', new Date(2026, 10, 18), 'en-US');
    expect(p.only).toBe('files');
    expect(p.hints.source).toBe('files');
    expect(hardFilterOf(p, undefined, p.hints)).toMatchObject({ source: 'files' });
    expect(hardFilterOf(p, { source: 'mail' }, { ...p.hints, source: 'mail' })).toMatchObject({ source: 'mail' });
    const word = parseQuestion('What did the pdf my landlord emailed say?', new Date(2026, 10, 18), 'en-US');
    expect(word.hints.source).toBe('files');   // a boost
    expect(hardFilterOf(word, undefined, word.hints).source).toBeUndefined();
  });

  it('only the right kinds pass', () => {
    expect(kindFits('files', 'document') && kindFits('files', 'note')).toBe(true);
    expect(kindFits('files', 'email') || kindFits('files', 'photo')).toBe(false);
    expect(kindFits('mail', 'email') && kindFits('photos', 'photo')).toBe(true);
    expect(passesFilter({ source: 'files' }, { kind: 'email', date: 0 })).toBe(false);
  });

  describe('search on the Playground', () => {
    let db: SieveDb;
    beforeAll(async () => {
      setMlClient(createHashEmbedClient());
      db = openDb('playground');
      await seedPlayground(db);
      await peekQueue(db)?.whenIdle();
    });
    afterAll(async () => {
      await wipeDb('playground');
      setMlClient(null);
    });

    it('a question limited to files finds only files, and nothing passes when no file matches', async () => {
      let report: SearchReport | undefined;
      const all = await search(db, 'What did my landlord say about the deposit?');
      expect(all.some((c) => c.recordId.includes('pg-mail'))).toBe(true);
      const files = await search(db, 'What did my landlord say about the deposit? Local files only.', { onReport: (r) => (report = r) });
      expect(report?.filters).toMatchObject({ source: 'files' });
      for (const c of files) expect(c.recordId).toMatch(/pg-doc/);
      const hinted = await search(db, 'What did my landlord say about the deposit?', { hints: { source: 'mail' } });
      expect(hinted.length).toBeGreaterThan(0);
      for (const c of hinted) expect(c.recordId).toMatch(/pg-mail/);
      const photos = await search(db, 'the deposit receipt, from my photos', { hints: { source: 'photos' } });
      for (const c of photos) expect(c.recordId).toMatch(/pg-photo/);
    });
  });
});
