// 70 section 3.1 with questions.json, text-vectors.json, hints-stored.json and emoji-graphemes.json.
import { MAX_QUESTION_CHARS } from '@sieve/shared';
import { describe, expect, it } from 'vitest';
import { forAll, int, stringOf, TRICKY_PIECES } from '../../../tests/harness/property';
import { corpus } from '../../../tests/harness/robustCorpus';
import { decodeEntities, isWellFormed, normalizeQuestion, parseStoredHints, toWellFormed, truncateGraphemes } from './question';

interface QExpected {
  ok?: boolean; error?: 'empty' | 'too-long'; text?: string; length?: number;
  removed?: { invisible?: number; bidi?: number; html?: boolean; tagTextIncludes?: string };
}

const graphemeEnds = (s: string): Set<number> => {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const ends = new Set<number>([0]);
  for (const g of seg.segment(s)) ends.add(g.index + g.segment.length);
  return ends;
};

describe('normalizeQuestion: questions.json', () => {
  for (const c of corpus<string, QExpected>('questions.json').cases) {
    it(c.id, () => {
      const r = normalizeQuestion(c.input);
      const e = c.expected;
      if (e.ok !== undefined) expect(r.ok).toBe(e.ok);
      if (e.error) expect(r.error).toBe(e.error);
      if (e.text !== undefined) expect(r.text).toBe(e.text);
      if (e.length !== undefined) expect(r.text.length).toBe(e.length);
      if (e.removed?.invisible !== undefined) expect(r.removed.invisible).toBe(e.removed.invisible);
      if (e.removed?.bidi !== undefined) expect(r.removed.bidi).toBe(e.removed.bidi);
      if (e.removed?.html !== undefined) expect(r.removed.html).toBe(e.removed.html);
      if (e.removed?.tagTextIncludes) expect(r.removed.tagText.join(' ')).toContain(e.removed.tagTextIncludes);
      expect(isWellFormed(r.text)).toBe(true);
    });
  }

  it('a non-string is empty with nothing removed', () => {
    for (const v of [undefined, null, 42, {}, ['a']]) {
      expect(normalizeQuestion(v)).toEqual({ ok: false, text: '', error: 'empty', removed: { invisible: 0, bidi: 0, tagText: [], html: false } });
    }
  });

  it('never truncates a long question (it reports too-long instead)', () => {
    const long = 'x'.repeat(MAX_QUESTION_CHARS + 1);
    const r = normalizeQuestion(long);
    expect(r).toMatchObject({ ok: false, error: 'too-long' });
    expect(r.text).toBe(long);
  });

  it('a tag run that decodes to a tag is cleaned to a fixed point', () => {
    const r = normalizeQuestion('<p>&lt;b&gt;deposit&lt;/b&gt;</p>');
    expect(r.text).toBe('deposit');
    expect(normalizeQuestion(r.text).text).toBe(r.text);
  });
});

describe('normalizeQuestion, truncateGraphemes: text-vectors.json', () => {
  type V = { fn: 'normalizeQuestion' | 'utf16_len' | 'truncateGraphemes'; value: string; max?: number };
  for (const c of corpus<V, { text?: string; units?: number; codePoints?: number }>('text-vectors.json').cases) {
    it(c.id, () => {
      const { fn, value, max } = c.input;
      if (fn === 'normalizeQuestion') expect(normalizeQuestion(value).text).toBe(c.expected.text);
      if (fn === 'truncateGraphemes') expect(truncateGraphemes(value, max ?? 0)).toBe(c.expected.text);
      if (fn === 'utf16_len') {
        expect(value.length).toBe(c.expected.units);
        expect([...value].length).toBe(c.expected.codePoints);
      }
    });
  }
});

describe('truncateGraphemes: emoji-graphemes.json at every cut', () => {
  for (const c of corpus<string, { graphemes: number; units: number }>('emoji-graphemes.json').cases) {
    it(c.id, () => {
      const s = `ab${c.input}cd`;
      expect(c.input.length).toBe(c.expected.units);
      for (let max = 0; max <= s.length + 1; max++) {
        const out = truncateGraphemes(s, max);
        expect(isWellFormed(out)).toBe(true);
        expect(s.startsWith(out)).toBe(true);
        expect(out.length).toBeLessThanOrEqual(max);
        expect(graphemeEnds(s).has(out.length)).toBe(true);
        if (max >= 2 && max < 2 + c.input.length) expect(out).toBe('ab');
      }
    });
  }
});

describe('properties (70 section 15.7, 1,000 runs each)', () => {
  it('normalizeQuestion is idempotent and well-formed', () => {
    forAll((r) => stringOf(r, TRICKY_PIECES, 40), (s) => {
      const once = normalizeQuestion(s);
      expect(isWellFormed(once.text)).toBe(true);
      expect(normalizeQuestion(once.text).text).toBe(once.text);
    });
  });

  it('truncateGraphemes returns a well-formed grapheme-boundary prefix', () => {
    const wellFormedPieces = TRICKY_PIECES.filter((p) => isWellFormed(p));
    forAll((r) => ({ s: stringOf(r, wellFormedPieces, 30), max: int(r, 0, 60) }), ({ s, max }) => {
      const out = truncateGraphemes(s, max);
      expect(isWellFormed(out)).toBe(true);
      expect(s.startsWith(out)).toBe(true);
      expect(out.length).toBeLessThanOrEqual(Math.max(0, max));
      expect(graphemeEnds(s).has(out.length)).toBe(true);
    });
  });
});

describe('decodeEntities (R-MAIL-05)', () => {
  it('decodes exactly the listed entities, once', () => {
    expect(decodeEntities('&amp; &lt; &gt; &quot; &#39; &apos; &nbsp;')).toBe('& < > " \' \' \u00A0');
    expect(decodeEntities('&#x1F382; &#127874; &#X41;')).toBe('🎂 🎂 A');
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&hellip; &mdash; &copy;')).toBe('&hellip; &mdash; &copy;');
  });

  it('invalid code points become U+FFFD', () => {
    expect(decodeEntities('&#0; &#xD800; &#1114112; &#99999999999;')).toBe('\uFFFD \uFFFD \uFFFD &#99999999999;');
  });

  it('leaves text without entities alone', () => {
    expect(decodeEntities('Tom & Jerry; 3 < 5')).toBe('Tom & Jerry; 3 < 5');
  });
});

describe('toWellFormed and isWellFormed', () => {
  it('repairs lone surrogates only', () => {
    expect(toWellFormed('a\uD800b\uDC00c🎂')).toBe('a\uFFFDb\uFFFDc🎂');
    expect(isWellFormed('🎂')).toBe(true);
    expect(isWellFormed('\uD83C')).toBe(false);
  });
});

describe('parseStoredHints: hints-stored.json (R-MCP-03)', () => {
  for (const c of corpus<unknown, Record<string, unknown> | null>('hints-stored.json').cases) {
    it(c.id, () => {
      const out = parseStoredHints(c.input);
      if (c.expected === null) expect(out).toBeUndefined();
      else expect(out).toEqual(c.expected);
    });
  }

  it('keeps one or two of Sieve\'s own categories and drops anything else', () => {
    expect(parseStoredHints({ categories: ['Money'] })).toEqual({ categories: ['Money'] });
    expect(parseStoredHints({ categories: ['Money', 'Home', 'Work'] })).toEqual({ categories: ['Money', 'Home'] });
    expect(parseStoredHints({ categories: ['Money', 'Money', 'Bills', 7, null] })).toEqual({ categories: ['Money'] });
    expect(parseStoredHints({ categories: ['Bills'] })).toBeUndefined();
    expect(parseStoredHints({ categories: 'Money' })).toBeUndefined();
  });

  it('keeps every valid field', () => {
    expect(parseStoredHints({ after: '2026-10-01', before: '2026-10-31', source: 'mail', from: 'Dana Whitfield', terms: ['4471', 'A1'] }))
      .toEqual({ after: '2026-10-01', before: '2026-10-31', source: 'mail', from: 'Dana Whitfield', terms: ['4471', 'A1'] });
  });

  it('drops an after date later than tomorrow when now is given', () => {
    const now = Date.parse('2026-11-16T10:00:00Z');
    expect(parseStoredHints({ after: '2026-11-17' }, now)).toEqual({ after: '2026-11-17' });
    expect(parseStoredHints({ after: '2026-11-19', before: '2026-12-01' }, now)).toEqual({ before: '2026-12-01' });
  });

  it('never throws on hostile shapes', () => {
    const hostile: unknown[] = [Object.create(null), { terms: { length: 3 } }, { from: { toString: () => 'x' } }, { after: new Date() }, 'hints', 0, true];
    for (const h of hostile) expect(() => parseStoredHints(h)).not.toThrow();
  });
});
