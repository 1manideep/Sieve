// AT-SAN-1 to AT-SAN-12 (11 section 14) and the hidden-text corpus (13.1). 11 runs these in browser mode; here they run
// in the web project's jsdom environment, which parses the same way for everything these cases use. AT-SAN-NET and
// the 2 MB timing on the demo Mac belong to the manual browser check (see the WP3 report).
import { describe, expect, test } from 'vitest';
import { checkInjection } from '../injection/check';
import { sanitizeIncoming } from '../sanitize/sanitize';
import { HIDDEN_CASES } from './helpers';

describe('hidden-text corpus (AT-SAN-1)', () => {
  let passed = 0;
  test.each(HIDDEN_CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const out = sanitizeIncoming({ html: c.html });
    for (const v of c.expectVisible) expect(out.text, `visible: ${v}`).toContain(v);
    for (const h of c.expectHidden) {
      expect(out.text, `hidden in text: ${h}`).not.toContain(h);
      expect(out.hiddenRemoved.some((f) => f.includes(h)), `hidden fragment: ${h} in ${JSON.stringify(out.hiddenRemoved)}`).toBe(true);
    }
    for (const a of c.expectAbsent ?? []) {
      expect(out.text).not.toContain(a);
      expect(out.hiddenRemoved.some((f) => f.includes(a))).toBe(false);
    }
    if (c.expectFragments !== undefined) expect(out.hiddenRemoved).toHaveLength(c.expectFragments);
    if (c.expectText !== undefined) expect(out.text).toBe(c.expectText);
    if (c.expectFragmentPrefix) expect(out.hiddenRemoved.some((f) => f.startsWith(c.expectFragmentPrefix!))).toBe(true);
    if (c.expectNoFragmentPrefix) expect(out.hiddenRemoved.some((f) => f.startsWith(c.expectNoFragmentPrefix!))).toBe(false);
    if (c.codeSuspicious) {
      const { finding } = await checkInjection(out.text, 'sample', { model: false, extraText: out.hiddenRemoved });
      expect(finding.suspicious).toBe(true);
    }
    passed++;
  });
  test('report', () => {
    console.log(`hidden-text corpus: ${passed}/${HIDDEN_CASES.length} cases pass`);
    expect(passed).toBe(HIDDEN_CASES.length);
  });
});

describe('sanitizeIncoming text structure', () => {
  test('AT-SAN-2 paragraphs', () => expect(sanitizeIncoming({ html: '<p>A</p><p>B</p>' }).text).toBe('A\n\nB'));
  test('AT-SAN-3 line breaks', () => expect(sanitizeIncoming({ html: 'Line1<br>Line2' }).text).toBe('Line1\nLine2'));
  test('AT-SAN-4 lists', () => expect(sanitizeIncoming({ html: '<ul><li>One</li><li>Two</li></ul>' }).text).toBe('- One\n- Two'));
  test('AT-SAN-5 entities', () => expect(sanitizeIncoming({ html: '<p>Tom &amp; Jerry&nbsp;&lt;3</p>' }).text).toBe('Tom & Jerry <3'));
  test('AT-SAN-6 links keep only their text', () => {
    expect(sanitizeIncoming({ html: '<a href="https://t.example/x?u=alex@example.com">Pay rent</a>' }).text).toBe('Pay rent');
  });
  test('AT-SAN-7 the text part is ignored when HTML exists', () => {
    expect(sanitizeIncoming({ html: '<div style="display:none">x</div>', text: 'plain alternative' }).text).toBe('');
  });
  test('AT-SAN-8 quoted history is removed', () => {
    const text = 'Thanks!\n\nOn Mon, Mar 2, 2026 at 9:00 AM Dana <d@x.example> wrote:\n> old\n> older';
    expect(sanitizeIncoming({ text }).text).toBe('Thanks!\n\n[quoted text not included]');
  });
  test('AT-SAN-9 keepQuoted keeps it', () => {
    const text = 'Thanks!\n\nOn Mon, Mar 2, 2026 at 9:00 AM Dana <d@x.example> wrote:\n> old\n> older';
    const out = sanitizeIncoming({ text }, { keepQuoted: true }).text;
    expect(out).toContain('> old');
    expect(out).toContain('> older');
  });
  test('AT-SAN-10 one in-word zero-width and a soft hyphen: no fragment', () => {
    expect(sanitizeIncoming({ text: 'a­b c​d' })).toEqual({ text: 'ab cd', hiddenRemoved: [] });
  });
  test('AT-SAN-12 nothing in, nothing out', () => expect(sanitizeIncoming({})).toEqual({ text: '', hiddenRemoved: [] }));
  test('tables put a space between cells', () => {
    expect(sanitizeIncoming({ html: '<table><tr><td>Rent</td><td>$1,620</td></tr><tr><td>Fee</td><td>$50</td></tr></table>' }).text).toBe('Rent $1,620\nFee $50');
  });
  test('only the selected option of a select', () => {
    expect(sanitizeIncoming({ html: '<p>Size <select><option>S</option><option selected>M</option></select> chosen</p>' }).text).toBe('Size M chosen');
  });
  test('pre keeps line breaks', () => expect(sanitizeIncoming({ html: '<pre>a\nb</pre>' }).text).toBe('a\nb'));
  test('Outlook reply header cuts the quoted part in text', () => {
    const text = 'See below.\n\nFrom: Dana Lee\nSent: Monday\nSubject: Rent\n\nOld text';
    expect(sanitizeIncoming({ text }).text).toBe('See below.\n\n[quoted text not included]');
  });
  test('a forwarded header is not quoted history', () => {
    const text = 'FYI\n\n---------- Forwarded message ---------\nFrom: Dana Lee\nDate: Monday\n\nForwarded body';
    expect(sanitizeIncoming({ text }).text).toContain('Forwarded body');
  });
  test('blockquote cite with its attribution is removed', () => {
    const out = sanitizeIncoming({ html: '<p>New text</p><div>On Monday Dana wrote:</div><blockquote type="cite">Old text</blockquote>' });
    expect(out.text).toBe('New text\n\n[quoted text not included]');
  });
  test('#divRplyFwdMsg removes the rest of the message', () => {
    const out = sanitizeIncoming({ html: '<p>Reply here</p><div id="divRplyFwdMsg">From: Dana<br>Subject: Rent</div><div>Old thread</div>' });
    expect(out.text).not.toContain('Old thread');
    expect(out.text).toContain('Reply here');
  });
  test('more than 50 fragments are summarized', () => {
    const html = Array.from({ length: 60 }, (_, i) => `<div style="display:none">Hidden piece ${i}</div>`).join('') + '<p>Shown</p>';
    const out = sanitizeIncoming({ html });
    expect(out.hiddenRemoved).toHaveLength(50);
    expect(out.hiddenRemoved[49]).toBe('and 11 more hidden pieces');
  });
  test('long fragments are cut with an ellipsis', () => {
    const out = sanitizeIncoming({ html: `<div style="display:none">${'word '.repeat(200)}</div><p>x</p>` });
    expect(out.hiddenRemoved[0]!.length).toBeLessThanOrEqual(500);
    expect(out.hiddenRemoved[0]!.endsWith('…')).toBe(true);
  });
  test('malformed HTML and invalid CSS do not throw', () => {
    expect(() => sanitizeIncoming({ html: '<div><p>Open <b>bold <style>.x{{{color:</style><span class="x">ok' })).not.toThrow();
    expect(sanitizeIncoming({ html: '<style>:::bad{display:none}</style><p>ok</p>' }).text).toBe('ok');
  });
  test('an entirely hidden email gives empty text and the fragments', () => {
    const out = sanitizeIncoming({ html: '<div style="display:none">All of it</div>' });
    expect(out).toEqual({ text: '', hiddenRemoved: ['All of it'] });
  });
  test('nothing is inserted into the live page', () => {
    const before = document.querySelectorAll('*').length;
    sanitizeIncoming({ html: '<img src="http://127.0.0.1:9/pixel.gif"><iframe src="http://127.0.0.1:9/frame"></iframe><p>Body</p>' });
    expect(document.querySelectorAll('*').length).toBe(before);
    expect(document.querySelectorAll('img, iframe')).toHaveLength(0);
  });
  test('AT-SAN-11 a 2 MB newsletter completes (time reported)', () => {
    const block = '<table style="width:100%"><tr><td style="font-size:14px;color:#333"><h2>Story title</h2><p>Some paragraph text about the news of the week, with a <a href="https://n.example/a">link</a>.</p></td></tr></table><div style="display:none">pre</div>';
    let html = '<style>.a{color:#333}@media (max-width:600px){.m{display:none}}</style>';
    while (html.length < 2_000_000) html += block;
    const t0 = performance.now();
    const out = sanitizeIncoming({ html });
    const ms = Math.round(performance.now() - t0);
    console.log(`AT-SAN-11: 2 MB HTML sanitized in ${ms} ms (jsdom; the 200 ms budget is for Chrome on the demo Mac)`);
    expect(out.text.length).toBeGreaterThan(0);
  }, 120_000);
});
