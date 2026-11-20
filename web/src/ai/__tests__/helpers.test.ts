import { describe, expect, it } from 'vitest';
import { NANO_PROMPT_BUDGET } from '@sieve/shared';
import { estimatePromptTokens, estimateTokens, charsForTokens } from '../budget';
import { extractFacts, findUnsupportedFacts, normFact } from '../facts';
import { partialJsonString, stripFences, validateJson } from '../json';
import { cleanModelSentence, contentWords, cutAtWord, escapeDelimiters, sentences, stem } from '../text';
import { BODIES } from './fixtures';

describe('text helpers (10 section 10.1)', () => {
  it('splits sentences with offsets into the text', () => {
    const ss = sentences(BODIES.deposit);
    expect(BODIES.deposit.slice(ss[1].start, ss[1].end)).toBe('We received your security deposit of $1,200 on March 3.');
    expect(ss[1]).toEqual({ start: 32, end: 87 });
    expect(sentences('One line\nTwo line').map((s) => s.end - s.start)).toEqual([8, 8]);
  });

  it('keeps content words and stems them', () => {
    expect(contentWords('Your deposit was $1,200, paid on March 3.')).toEqual(['deposit', 'paid', 'march']);
    expect(stem('moves')).toBe('move');
    expect(stem('pets')).toBe('pets');          // 'pet' would be under 4 letters
    expect(stem('pounds')).toBe('pound');
    expect(stem('paid')).toBe('paid');
    expect(stem('booking')).toBe('book');
    expect(stem('bus')).toBe('bus');
  });

  it('cuts at a word boundary and breaks up delimiters', () => {
    expect(cutAtWord('one two three four', 12)).toBe('one two...');
    expect(cutAtWord('short', 12)).toBe('short');
    expect(escapeDelimiters('a <<< b >>> c')).toBe('a < < < b > > > c');
  });

  it('cleans model sentences', () => {
    expect(cleanModelSentence('  "Answer: Your deposit was $1,200."  ', 300)).toBe('Your deposit was $1,200.');
    const long = `A dog playing in a park. It is sunny${' and bright'.repeat(25)}.`;
    expect(long.length).toBeGreaterThan(250);
    expect(cleanModelSentence(long, 200)).toBe('A dog playing in a park.');
    const noStop = 'word '.repeat(80).trim();
    const cut = cleanModelSentence(noStop, 50);
    expect(cut.length).toBeLessThanOrEqual(50);
    expect(cut.endsWith('.')).toBe(true);
  });
});

describe('fact helpers (10 section 10.1)', () => {
  it('normalizes amounts, dates, times and literals', () => {
    expect(['$1,200', '1200', '1,200', '$1,200.00'].map(normFact)).toEqual(['num:1200', 'num:1200', 'num:1200', 'num:1200']);
    expect(normFact('March 3')).toBe('date:mar-3');
    expect(normFact('3 March')).toBe('date:mar-3');
    expect(normFact('7:45 AM')).toBe('time:7:45');
    expect(normFact('Dana@Oakview.example.')).toBe('lit:dana@oakview.example');
  });

  it('extracts facts in order, ignoring [...] placeholders', () => {
    expect(extractFacts('Paid $1,200 on March 3 at 7:45 AM [move-out date 4]')).toEqual(['$1,200', 'March 3', '7:45 AM']);
  });

  it('finds unsupported facts in drafts (DR prototypes)', () => {
    const approved = 'Your deposit was $1,200, paid on March 3.';
    expect(findUnsupportedFacts('Thanks for the $1,200 on March 3. When is [move-out date]?', [approved, 'Draft a reply.'])).toEqual([]);
    expect(findUnsupportedFacts('My deposit of $1,500 paid on March 3. I expect it back within 30 days.', [approved])).toEqual(['$1,500', '30']);
    expect(findUnsupportedFacts('1200 dollar deposit on 3 March', [approved])).toEqual([]);
  });
});

describe('json helpers (10 section 9.3)', () => {
  const schema = { type: 'object', properties: { item: { type: 'string', enum: ['P1', 'none'] }, n: { type: 'integer' } }, required: ['item'] };
  it('validates type, enum, required, items and nullable', () => {
    expect(validateJson(schema, { item: 'P1', n: 2 })).toBe(true);
    expect(validateJson(schema, { item: 'P9' })).toBe(false);
    expect(validateJson(schema, { n: 1 })).toBe(false);
    expect(validateJson(schema, { item: 'P1', n: 1.5 })).toBe(false);
    expect(validateJson({ type: 'array', items: { type: 'string' } }, ['a', 1])).toBe(false);
    expect(validateJson({ type: 'string', nullable: true }, null)).toBe(true);
  });

  it('strips fences', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n{"a":1}```')).toBe('{"a":1}');
  });

  it('reads the decoded prefix of a partial string value', () => {
    expect(partialJsonString('{"item":"P1","answer":"Your dep', 'answer')).toBe('Your dep');
    expect(partialJsonString('{"item":"P1","answer":"a \\"q\\" \\u00e9 end\\', 'answer')).toBe('a "q" é end');
    expect(partialJsonString('{"item":"P1","answer":"x \\u00', 'answer')).toBe('x ');
    expect(partialJsonString('{"item":"P1"', 'answer')).toBe('');
  });
});

describe('budget (10 section 9.4, 70 R-MDL-09)', () => {
  it('estimates 3 characters per token', () => {
    expect(estimateTokens('abcdef')).toBe(2);
    expect(estimateTokens('abcdefg')).toBe(3);
    expect(charsForTokens(10)).toBe(30);
    expect(estimatePromptTokens({ system: 'abc', texts: ['abcdef'], images: 1 })).toBe(1 + 2 + 1 + 1500 + 60);
  });

  it('counts Japanese, Chinese, Korean and Thai characters as one token each', () => {
    const japanese = '敷金は千二百ドルでした。'.repeat(500);
    expect(japanese.length).toBe(6000);
    expect(estimateTokens(japanese)).toBeGreaterThanOrEqual(6000);
    expect(estimateTokens(japanese)).toBeGreaterThan(NANO_PROMPT_BUDGET - 1001);
  });
});
