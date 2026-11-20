// 20 section 20, emoji and encodings: A-EM-3 (grapheme-safe cuts), A-EM-4 (name lookup); 20 section 8.2 tokenizer.
import { describe, expect, it } from 'vitest';
import { buildPreview } from './preview';
import { cutAtWord, cutGraphemes, emojiNames, graphemes, withEmojiNames } from './text';
import { processTerm, sStem, tokenize } from './tokenize';

const TRICKY = ['👨‍👩‍👧', '👍🏽', '🇮🇳', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '1️⃣'];

describe('cutGraphemes (A-EM-3)', () => {
  it('never splits a tricky grapheme at any maxUnits', () => {
    for (const g of TRICKY) {
      const s = `ab ${g} cd ${g}`;
      for (let n = 0; n <= s.length + 1; n++) {
        const cut = cutGraphemes(s, n);
        expect(cut.length).toBeLessThanOrEqual(n);
        expect(s.startsWith(cut)).toBe(true);
        const gs = graphemes(s);
        let acc = '';
        const boundaries = new Set([0]);
        for (const x of gs) boundaries.add((acc += x).length);
        expect(boundaries.has(cut.length)).toBe(true);
      }
    }
  });

  it('leaves a ZWJ family out whole when it does not fit', () => {
    expect(cutGraphemes('Family 👨‍👩‍👧', 9)).toBe('Family ');
    expect(cutGraphemes('Family 👨‍👩‍👧', 15)).toBe('Family 👨‍👩‍👧');
  });

  it('counts the ellipsis', () => {
    expect(cutGraphemes('abcdefgh', 5, '…')).toBe('abcd…');
    expect(cutAtWord('the quick brown fox jumps', 15)).toBe('the quick…');
  });

  it('previews of a text with a ZWJ family at the cut point end before it', () => {
    const text = 'x'.repeat(276) + ' 👨‍👩‍👧 more';
    const p = buildPreview({ kind: 'note', text, date: 0 });
    expect(p.length).toBeLessThanOrEqual(280);
    expect(p).not.toContain('\uD83D‍');
    expect(p.endsWith('…')).toBe(true);
  });
});

describe('emoji names (A-EM-4)', () => {
  it('finds names for ✈️ and bare ✈, 👍🏽 as thumbs up, and nothing for an unknown pictograph', () => {
    expect(emojiNames('✈️')).toEqual(['airplane']);
    expect(emojiNames('✈')).toEqual(['airplane']);
    expect(emojiNames('👍🏽')).toEqual(['thumbs up']);
    expect(emojiNames('\u{1FC01}')).toEqual([]);
  });

  it('adds names only to what is indexed', () => {
    expect(withEmojiNames('🎂🎉')).toBe('🎂🎉 (birthday cake, party popper)');
    expect(withEmojiNames('no emoji')).toBe('no emoji');
    expect(emojiNames('Are we still on for Saturday? 🧺🥕')).toEqual(['basket', 'carrot']);
  });
});

describe('tokenizer and stemmer (20 section 8.2)', () => {
  it('expands numbers, hyphens and apostrophes', () => {
    expect(tokenize('$1,200 and 45.00')).toEqual(['1200', 'and', '45.00', '45']);
    expect(tokenize('W-2 RX-6620194')).toEqual(['W2', 'W', '2', 'RX6620194', 'RX', '6620194']);
    expect(tokenize("landlord's dog’s")).toEqual(['landlord', 'dog']);
    expect(tokenize('order #88231')).toEqual(['order', '88231']);
  });

  it('drops stop words and stems with exceptions', () => {
    expect(processTerm('The')).toBeNull();
    expect(processTerm('a')).toBeNull();
    expect(processTerm('deposits')).toBe('deposit');
    expect(sStem('deliveries')).toBe('delivery');
    expect(sStem('news')).toBe('news');
    expect(sStem('glass')).toBe('glass');
    expect(processTerm('emails')).toBeNull();
  });
});
