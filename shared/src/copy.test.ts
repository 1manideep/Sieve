import { describe, expect, it } from 'vitest';
import {
  LADDER_LABELS,
  RESULT_LINES,
  WARNING_ORDER,
  WARNING_TITLES,
  fullStepLabel,
  ladderSegmentLabel,
  stepPhrase,
  warningTitle,
} from './copy';
import { LADDER_STEPS } from './constants';
import type { WarningKind } from './types';

const ALL_WARNING_KINDS: WarningKind[] = [
  'ask-first', 'injection', 'hidden-text-removed', 'pii-redacted', 'pii-check-limited',
  'cloud-fallback', 'sample-data-cloud', 'unverified-answer', 'source-unchecked',
];

describe('ladder labels', () => {
  it('names each step', () => {
    expect(LADDER_STEPS.map((s) => LADDER_LABELS[s])).toEqual(['Answer only', 'Excerpt', 'Full item']);
  });

  it('builds the segment labels with the kind noun', () => {
    expect(ladderSegmentLabel('answer')).toBe('1 · Answer only');
    expect(ladderSegmentLabel('excerpt')).toBe('2 · Excerpt');
    expect(ladderSegmentLabel('full', 'email')).toBe('3 · Full email');
    expect(ladderSegmentLabel('full')).toBe('3 · Full item');
    expect(fullStepLabel('photo')).toBe('Full photo');
  });
});

describe('stepPhrase', () => {
  it('describes what was shared', () => {
    expect(stepPhrase('answer', 'email', 1)).toBe('the answer');
    expect(stepPhrase('excerpt', 'document', 1)).toBe('an excerpt');
    expect(stepPhrase('full', 'email', 1)).toBe('the full email');
    expect(stepPhrase('full', 'photo', 1)).toBe('the full photo');
  });

  it('adds the item count when related items were included', () => {
    expect(stepPhrase('excerpt', 'email', 3)).toBe('an excerpt from 3 items');
  });
});

describe('warning titles', () => {
  it('has an entry for every warning kind, in a fixed order', () => {
    expect(Object.keys(WARNING_TITLES).sort()).toEqual([...ALL_WARNING_KINDS].sort());
    expect([...WARNING_ORDER].sort()).toEqual([...ALL_WARNING_KINDS].sort());
  });

  it('fills the category into the ask-first title', () => {
    expect(warningTitle('ask-first', 'Money')).toBe('Money asks first');
    expect(warningTitle('injection')).toBe('Possible instruction aimed at an AI');
    expect(warningTitle('unverified-answer')).toBeNull();
  });
});

describe('result lines', () => {
  it('matches the copy in 40 section 16.14', () => {
    expect(RESULT_LINES.sent({ aiName: 'Gemini CLI', stepPhrase: 'the answer' })).toBe('Sent the answer to Gemini CLI. Receipt saved.');
    expect(RESULT_LINES.declined({ aiName: 'Gemini CLI' })).toBe('Denied. Gemini CLI was told you declined.');
    expect(RESULT_LINES.blocked({ aiName: 'Gemini CLI', category: 'Health' })).toBe(
      'Health is never shared, so Sieve told Gemini CLI no. Nothing left this device, and no model read the item.',
    );
    expect(RESULT_LINES.expired()).toBe('This request expired before you answered it. Nothing was sent.');
  });
});

describe('copy style', () => {
  it('never uses an em dash', () => {
    const strings = [
      ...Object.values(LADDER_LABELS),
      ...Object.values(WARNING_TITLES).filter((t): t is string => t !== null),
      RESULT_LINES.sent({ aiName: 'A', stepPhrase: 'the answer' }),
      RESULT_LINES.declined({ aiName: 'A' }),
      RESULT_LINES.blocked({ aiName: 'A', category: 'Health' }),
      RESULT_LINES.noMatch({ aiName: 'A' }),
      RESULT_LINES.error({ aiName: 'A' }),
      RESULT_LINES.expired(),
      RESULT_LINES.revoked({ aiName: 'A' }),
    ];
    for (const s of strings) expect(s).not.toContain('—');
  });
});
