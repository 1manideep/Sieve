import { describe, expect, it } from 'vitest';
import { DECIDE_ERRORS } from '@/copy/strings';
import { compose, entry, option, proposal, request, T0 } from './__tests__/fixtures';
import { validateDecision } from './decision';
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
