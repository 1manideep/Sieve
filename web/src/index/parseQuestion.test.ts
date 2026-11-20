// 20 section 9: A-PQ-1 (typos with the word list and a seeded index), A-PQ-4 (hints), A-EM-6 (emoji in questions).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { setMlClient } from '../ml/client';
import { seedPlayground } from '../playground/seed';
import { PLAYGROUND_NOW } from './config';
import { openDb, type SieveDb } from './db';
import { loadDictionaryText, resetDictionary } from './dictionary';
import { whenVocabReady, wipeDb } from './lifecycle';
import { parseQuestion } from './parseQuestion';
import { osaDistance } from './typos';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/playground/assets', async () => (await import('../../../tests/harness/dataset')).assetsModule);

process.env.TZ = 'America/Chicago';
const NOW = new Date(PLAYGROUND_NOW);
let db: SieveDb;

beforeAll(async () => {
  setMlClient(createHashEmbedClient());
  loadDictionaryText(readFileSync(join(process.cwd(), 'web/src/index/dict/en-words.tsv'), 'utf8'));
  db = openDb('playground');
  await seedPlayground(db);
  await whenVocabReady(db);
});

afterAll(async () => {
  await wipeDb('playground');
  setMlClient(null);
});

describe('typo correction (A-PQ-1)', () => {
  it('corrects the heavy-typo question against the index and the word list', () => {
    const p = parseQuestion('waht did my landlrod say abot the deposti', NOW, 'en-US', { db });
    expect(p.corrected).toBe('what did my landlord say about the deposit');
    expect(p.normalized).toBe('waht did my landlrod say abot the deposti');
  });

  it('leaves valid words, ids and capitalized names alone', () => {
    for (const q of ['When does my flight leave?', 'any alert from the bank', 'what did they say', 'send me the pics', 'Where is K7Q2LM and 88231?', 'Did Brennagh send it?']) {
      expect(parseQuestion(q, NOW, 'en-US', { db }).corrected).toBe(q);
    }
  });

  it('makes no correction before the word list is loaded', () => {
    resetDictionary();
    expect(parseQuestion('waht did my landlrod say', NOW, 'en-US', { db }).corrected).toBe('waht did my landlrod say');
    loadDictionaryText(readFileSync(join(process.cwd(), 'web/src/index/dict/en-words.tsv'), 'utf8'));
  });

  it('OSA distance counts a swap as one edit', () => {
    expect(osaDistance('waht', 'what')).toBe(1);
    expect(osaDistance('landlrod', 'landlord')).toBe(1);
    expect(osaDistance('abc', 'xyz', 1)).toBe(2);
  });
});

describe('hints (A-PQ-4)', () => {
  it('emails from Dana in October', () => {
    const p = parseQuestion('emails from Dana in October', NOW, 'en-US', { db });
    expect(p.hints).toMatchObject({ source: 'mail', from: 'Dana', after: '2026-10-01', before: '2026-10-31' });
    expect(p.sender).toBe('Dana');
  });

  it('the sender cue (9.4): a named sender, never a role or a place', () => {
    expect(parseQuestion('What did Priya say about the agenda?', NOW, 'en-US', { db }).sender).toBe('Priya');
    expect(parseQuestion('what did kestrelmoor send me', NOW, 'en-US', { db }).sender).toBe('kestrelmoor');
    expect(parseQuestion('What did my landlord say?', NOW, 'en-US', { db }).sender).toBeUndefined();
    expect(parseQuestion('When does my flight from Seattle leave?', NOW, 'en-US', { db }).sender).toBeUndefined();
    expect(parseQuestion('photos from Hawaii', NOW, 'en-US', { db }).sender).toBeUndefined();
  });

  it('order numbers become terms; my landlord becomes the from hint', () => {
    expect(parseQuestion('Where is order #88231?', NOW, 'en-US', { db }).hints.terms).toEqual(['88231']);
    expect(parseQuestion('What did my landlord say?', NOW, 'en-US', { db }).hints.from).toBe('landlord');
    expect(parseQuestion('send me the pics', NOW, 'en-US', { db }).hints.source).toBe('photos');
  });

  it('normalizes quotes and whitespace and caps the length', () => {
    const p = parseQuestion('  What’s   my\n balance?  ', NOW, 'en-US', { db });
    expect(p.normalized).toBe("What's my balance?");
    expect(parseQuestion('a'.repeat(900), NOW, 'en-US', { db }).normalized.length).toBe(500);
  });
});

describe('emoji in questions (A-EM-6)', () => {
  it('keeps the emoji in corrected and adds names only to searchText', () => {
    const p = parseQuestion('🎂 photos', NOW, 'en-US', { db });
    expect(p.corrected).toBe('🎂 photos');
    expect(p.searchText).toContain('birthday cake');
    expect(parseQuestion('no emoji here', NOW, 'en-US', { db }).searchText).toBeUndefined();
  });
});
