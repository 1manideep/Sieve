import { describe, expect, it } from 'vitest';
import { DECIDE_ERRORS } from '@/copy/strings';
import { compose, entry, option, proposal, request, T0 } from './__tests__/fixtures';
import { textHashOf, validateDecision } from './decision';
import { DECISION_WINDOW_MS } from './constants';

const NOW = T0 + 60_000;

describe('validateDecision', () => {
  it('rejects a missing entry, or one not waiting for the person', () => {
    expect(validateDecision(undefined, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' }, NOW, compose)).toEqual({
      ok: false,
      reason: 'not-pending',
      message: DECIDE_ERRORS.notPending,
    });
    const preparing = entry({ phase: 'preparing' });
    expect(validateDecision(preparing, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' }, NOW, compose)).toMatchObject({
      ok: false,
      reason: 'not-pending',
    });
    const notReady = entry({ proposal: proposal({ outcome: 'needs-cloud-consent' }) });
    expect(validateDecision(notReady, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' }, NOW, compose)).toMatchObject({
      reason: 'not-pending',
    });
  });

  it('a decline is allowed whatever the outcome, while the request waits', () => {
    const consent = entry({ proposal: proposal({ outcome: 'needs-cloud-consent' }) });
    const v = validateDecision(consent, { requestId: 'req1', approved: false, decidedBy: 'app' }, NOW, compose);
    expect(v).toMatchObject({ ok: true, decision: { approved: false, itemIds: ['gmail:m1'], decidedAt: NOW } });
    if (v.ok) expect(v.decision.step).toBeUndefined();
  });

  it('rejects after the decision window (the earlier of expireAt and createdAt + 120 min)', () => {
    const e = entry();
    const late = T0 + DECISION_WINDOW_MS;
    expect(validateDecision(e, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' }, late, compose)).toEqual({
      ok: false,
      reason: 'expired',
      message: DECIDE_ERRORS.expired,
    });
    const shortTtl = entry({ request: request({ status: 'awaiting-person', expireAt: T0 + 30_000 }) });
    expect(validateDecision(shortTtl, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' }, NOW, compose)).toMatchObject({
      reason: 'expired',
    });
  });

  it('rejects a step above maxStep', () => {
    const e = entry({ proposal: proposal({ maxStep: 'answer' }) });
    expect(validateDecision(e, { requestId: 'req1', approved: true, step: 'excerpt', decidedBy: 'app' }, NOW, compose)).toEqual({
      ok: false,
      reason: 'invalid-step',
      message: DECIDE_ERRORS.invalidStep,
    });
  });

  it('rejects an unavailable option and a missing step', () => {
    const p = proposal();
    p.options[1] = option('excerpt', 'x', { available: false, unavailableReason: 'no' });
    const e = entry({ proposal: p });
    expect(validateDecision(e, { requestId: 'req1', approved: true, step: 'excerpt', decidedBy: 'app' }, NOW, compose)).toMatchObject({
      reason: 'invalid-step',
    });
    expect(validateDecision(e, { requestId: 'req1', approved: true, decidedBy: 'app' }, NOW, compose)).toMatchObject({ reason: 'invalid-step' });
  });

  it('the app approves the main item plus the ticked related items; the extension approves the main item only', () => {
    const rel = [option('answer', '', { available: false }), option('excerpt', 'Also shared: lease'), option('full', 'Also shared: lease, full')];
    const e = entry({ relatedSelected: ['gmail:m2'], relatedOptions: { 'gmail:m2': rel }, lastPreviewItemIds: ['gmail:m1'] });
    const app = validateDecision(e, { requestId: 'req1', approved: true, step: 'excerpt', decidedBy: 'app' }, NOW, compose);
    expect(app).toMatchObject({ ok: true, decision: { itemIds: ['gmail:m1', 'gmail:m2'], decidedBy: 'app' } });
    if (app.ok) expect(app.text).toBe(`${e.proposal!.options[1].text}\n\nAlso shared: lease`);
    const ext = validateDecision(e, { requestId: 'req1', approved: true, step: 'excerpt', decidedBy: 'extension' }, NOW, compose);
    expect(ext).toMatchObject({ ok: true, decision: { itemIds: ['gmail:m1'], decidedBy: 'extension' } });
    if (ext.ok) expect(ext.text).toBe(e.proposal!.options[1].text);
  });

  it('rejects a related item whose option at the step is unavailable', () => {
    const rel = [option('answer', '', { available: false }), option('excerpt', 'e'), option('full', 'f')];
    const e = entry({ relatedSelected: ['gmail:m2'], relatedOptions: { 'gmail:m2': rel } });
    expect(validateDecision(e, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'app' }, NOW, compose)).toMatchObject({
      reason: 'invalid-step',
    });
  });

  it('rejects a composed text over 8,000 characters', () => {
    const big = 'x'.repeat(5000);
    const rel = [option('answer', '', { available: false }), option('excerpt', big), option('full', big)];
    const p = proposal();
    p.options[1] = option('excerpt', big);
    const e = entry({ proposal: p, relatedSelected: ['gmail:m2'], relatedOptions: { 'gmail:m2': rel } });
    expect(validateDecision(e, { requestId: 'req1', approved: true, step: 'excerpt', decidedBy: 'app' }, NOW, compose)).toEqual({
      ok: false,
      reason: 'too-long',
      message: DECIDE_ERRORS.tooLong,
    });
  });

  it('sets decidedAt to now (the extension time is never used)', () => {
    const v = validateDecision(entry(), { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'extension' }, NOW, compose);
    expect(v).toMatchObject({ ok: true, decision: { decidedAt: NOW, step: 'answer' } });
  });
});

describe('textHash: an extension approval names the text it showed (50 section 6.2 rule 7)', () => {
  it('is 16 hex characters, stable, and changes when any of the three texts changes', () => {
    const p = proposal();
    const h = textHashOf(p.options);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(textHashOf(proposal().options)).toBe(h);
    for (const i of [0, 1, 2]) {
      const changed = proposal();
      changed.options[i] = { ...changed.options[i]!, text: `${changed.options[i]!.text}.` };
      expect(textHashOf(changed.options)).not.toBe(h);
    }
    // Text moved between steps is a different proposal, even with the same characters overall.
    expect(textHashOf([option('answer', 'ab'), option('excerpt', 'c'), option('full', '')])).not.toBe(
      textHashOf([option('answer', 'a'), option('excerpt', 'bc'), option('full', '')]),
    );
    expect(textHashOf(undefined)).toBe(textHashOf([option('answer', ''), option('excerpt', ''), option('full', '')]));
  });

  it('accepts an approval whose hash matches the current text', () => {
    const e = entry();
    const v = validateDecision(e, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'extension', textHash: textHashOf(e.proposal!.options) }, NOW, compose);
    expect(v).toMatchObject({ ok: true, decision: { step: 'answer', decidedBy: 'extension' } });
  });

  it('refuses an approval of text that changed since the preview, as no longer pending (the page re-sends its list)', () => {
    const shown = entry();
    const textHash = textHashOf(shown.proposal!.options);
    const p = proposal();
    p.options[0] = option('answer', 'A different answer, prepared again.');
    const now = entry({ proposal: p });
    expect(validateDecision(now, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'extension', textHash }, NOW, compose)).toEqual({
      ok: false,
      reason: 'not-pending',
      message: DECIDE_ERRORS.notPending,
    });
  });

  it('a 0.1.0 extension sends no hash and is not compared; a decline is never compared', () => {
    const e = entry();
    expect(validateDecision(e, { requestId: 'req1', approved: true, step: 'answer', decidedBy: 'extension' }, NOW, compose)).toMatchObject({ ok: true });
    expect(validateDecision(e, { requestId: 'req1', approved: false, decidedBy: 'extension', textHash: 'ffffffffffffffff' }, NOW, compose)).toMatchObject({
      ok: true,
      decision: { approved: false },
    });
  });
});
