import { describe, expect, it } from 'vitest';
import { WARNING_ORDER, type Warning } from '@sieve/shared';
import { compose, entry, option, proposal, request } from './__tests__/fixtures';
import { composedOption, pendingPreviews, toPreview, truncateGraphemes, PREVIEW_LIMITS } from './preview';

describe('composedOption', () => {
  it('is the main option when nothing related is ticked', () => {
    const e = entry();
    expect(composedOption(e, 'excerpt', compose)).toBe(e.proposal!.options[1]);
  });

  it('composes the main and the ticked related options, summing redactions', () => {
    const rel = [option('answer', '', { available: false, unavailableReason: 'Related items can be shared as an excerpt or the full item.' }), option('excerpt', 'Also: lease', { redactions: 2 }), option('full', 'Also: lease full')];
    const e = entry({ relatedSelected: ['gmail:m2'], relatedOptions: { 'gmail:m2': rel } });
    const o = composedOption(e, 'excerpt', compose);
    expect(o.text).toBe(`${e.proposal!.options[1].text}\n\nAlso: lease`);
    expect(o.chars).toBe(o.text.length);
    expect(o.redactions).toBe(2);
    expect(o.available).toBe(true);
    const a = composedOption(e, 'answer', compose);
    expect(a.available).toBe(false);
    expect(a.unavailableReason).toBe('Related items can be shared as an excerpt or the full item.');
  });

  it('is unavailable over the cap', () => {
    const big = 'y'.repeat(7000);
    const rel = [option('answer', '', { available: false }), option('excerpt', big), option('full', big)];
    const p = proposal();
    p.options[1] = option('excerpt', 'z'.repeat(2000));
    const e = entry({ proposal: p, relatedSelected: ['gmail:m2'], relatedOptions: { 'gmail:m2': rel } });
    const o = composedOption(e, 'excerpt', compose);
    expect(o.available).toBe(false);
    expect(o.unavailableReason).toBe('Too long to send at once');
  });
});

describe('toPreview', () => {
  it('never contains recordId, from, related, trace or images', () => {
    const p = proposal();
    p.options[2] = { ...p.options[2], image: { mime: 'image/jpeg', base64: 'AAAA', width: 1, height: 1, bytes: 3 } };
    const preview = toPreview(entry({ proposal: p }))!;
    const json = JSON.stringify(preview);
    expect(json).not.toContain('recordId');
    expect(json).not.toContain('gmail:m1');
    expect(json).not.toContain('Landlord <l@example.com>');
    expect(json).not.toContain('"related"');
    expect(json).not.toContain('"trace"');
    expect(json).not.toContain('base64');
    expect(preview.item).toEqual({ title: 'Re: Deposit for the apartment', kind: 'email', category: 'Home', date: p.item!.date });
    expect(preview.options.map((o) => o.step)).toEqual(['answer', 'excerpt', 'full']);
    expect(preview.options[0]).toEqual({ step: 'answer', text: p.options[0].text, chars: p.options[0].chars, redactions: 0, available: true });
  });

  it('clamps long titles, many warnings and long reasons (70 R-RLY-12)', () => {
    const warnings: Warning[] = Array.from({ length: 15 }, (_, i) => ({ kind: WARNING_ORDER[i % WARNING_ORDER.length], message: 'w'.repeat(400) }));
    const p = proposal({ warnings, item: { ...proposal().item!, title: 'T'.repeat(1000) } });
    p.options[2] = option('full', 'f', { available: false, unavailableReason: 'r'.repeat(500) });
    const preview = toPreview(entry({ proposal: p }))!;
    expect(preview.item!.title.length).toBe(PREVIEW_LIMITS.title);
    expect(preview.warnings).toHaveLength(PREVIEW_LIMITS.warnings);
    expect(preview.warnings.every((w) => w.message.length === PREVIEW_LIMITS.warning)).toBe(true);
    expect(preview.options[2].unavailableReason!.length).toBe(PREVIEW_LIMITS.reason);
    // display order kept
    const ranks = preview.warnings.map((w) => WARNING_ORDER.indexOf(w.kind));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('cuts at whole graphemes', () => {
    expect(truncateGraphemes('ab👍🏽cd', 3)).toBe('ab');
    expect(truncateGraphemes('short', 10)).toBe('short');
  });
});

describe('pendingPreviews', () => {
  it('lists only outside entries waiting for the person, oldest first, with the main item ids', () => {
    const old = entry({ requestId: 'a', proposal: proposal({ requestId: 'a', createdAt: 1 }), request: request({ id: 'a' }) });
    const newer = entry({ requestId: 'b', proposal: proposal({ requestId: 'b', createdAt: 2 }), request: request({ id: 'b' }) });
    const preparing = entry({ requestId: 'c', phase: 'preparing', proposal: undefined });
    const done = entry({ requestId: 'd', phase: 'done' });
    const inApp = entry({ requestId: 'e', proposal: proposal({ requestId: 'e', requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' } }) });
    const { previews, ids } = pendingPreviews([newer, preparing, old, done, inApp]);
    expect(previews.map((p) => p.requestId)).toEqual(['a', 'b']);
    expect(ids).toEqual({ a: ['gmail:m1'], b: ['gmail:m1'] });
  });

  it('keeps at most 20, and drops the newest when the message would be too big', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      entry({ requestId: `r${i}`, proposal: proposal({ requestId: `r${i}`, createdAt: i }), request: request({ id: `r${i}` }) }),
    );
    expect(pendingPreviews(many).previews).toHaveLength(20);
    const huge = Array.from({ length: 20 }, (_, i) => {
      const p = proposal({ requestId: `h${i}`, createdAt: i });
      p.options = p.options.map((o) => ({ ...o, text: '"'.repeat(8000), chars: 8000 }));   // JSON doubles every quote
      return entry({ requestId: `h${i}`, proposal: p, request: request({ id: `h${i}` }) });
    });
    const { previews } = pendingPreviews(huge);
    expect(previews.length).toBeLessThan(20);
    expect(previews[0].requestId).toBe('h0');
    expect(JSON.stringify(previews).length).toBeLessThanOrEqual(500_000);
  });
});
