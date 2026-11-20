import { describe, expect, it } from 'vitest';
import type { DataClass, InferenceModeName, NanoAvailability } from '@sieve/shared';
import { hasFreshConsent, resolveRoute } from '../policy';
import type { Purpose } from '../types';
import { bareDb, fakeDb } from './fakeDb';

function route(purpose: Purpose, data: DataClass, requestedMode: InferenceModeName, text: NanoAvailability, opts: { image?: NanoAvailability; isImage?: boolean; cloud?: boolean; consent?: boolean } = {}) {
  return resolveRoute({
    purpose, data, requestedMode, image: opts.isImage ?? false,
    nano: { text, image: opts.image ?? text },
    ownCloudAllowed: opts.cloud ?? false, consentOk: opts.consent ?? false,
  });
}

describe('resolveRoute (10 section 16.2)', () => {
  it('PO-1: own data with Nano runs on the device only', () => {
    expect(route('select-answer', 'own', 'ONLY_ON_DEVICE', 'available')).toEqual({ ok: true, mode: 'ONLY_ON_DEVICE' });
  });
  it('PO-2: own data without Nano and fallback off fails unavailable', () => {
    const r = route('select-answer', 'own', 'ONLY_ON_DEVICE', 'unavailable');
    expect(r).toMatchObject({ ok: false, code: 'unavailable' });
    expect(!r.ok && r.message.endsWith('Cloud fallback for your own data is off.')).toBe(true);
  });
  it('PO-3: own data while downloading fails downloading', () => {
    expect(route('select-answer', 'own', 'ONLY_ON_DEVICE', 'downloading')).toMatchObject({ ok: false, code: 'downloading' });
  });
  it('PO-4: own data, fallback on, no consent: needs-consent', () => {
    expect(route('select-answer', 'own', 'ONLY_ON_DEVICE', 'unavailable', { cloud: true })).toMatchObject({ ok: false, code: 'needs-consent' });
  });
  it('PO-5: own data, fallback on and consent: the cloud, labelled', () => {
    expect(route('select-answer', 'own', 'ONLY_ON_DEVICE', 'unavailable', { cloud: true, consent: true })).toEqual({
      ok: true, mode: 'ONLY_IN_CLOUD', warning: 'cloud-fallback',
    });
  });
  it('PO-6: own labels never reach the cloud', () => {
    expect(route('label', 'own', 'ONLY_ON_DEVICE', 'unavailable', { cloud: true, consent: true })).toMatchObject({ ok: false, code: 'unavailable' });
  });
  it('PO-7: pii-check never runs in the cloud, for any data', () => {
    expect(route('pii-check', 'sample', 'PREFER_ON_DEVICE', 'no-api')).toMatchObject({ ok: false, code: 'unavailable' });
  });
  it('PO-8: sample data with Nano prefers the device', () => {
    expect(route('select-answer', 'sample', 'PREFER_ON_DEVICE', 'available')).toEqual({ ok: true, mode: 'PREFER_ON_DEVICE' });
  });
  it('PO-9: sample data without Nano falls back to the cloud, labelled', () => {
    expect(route('select-answer', 'sample', 'PREFER_ON_DEVICE', 'no-api')).toEqual({ ok: true, mode: 'ONLY_IN_CLOUD', warning: 'sample-data-cloud' });
  });
  it('PO-10: a caller may always ask for more privacy', () => {
    expect(route('select-answer', 'sample', 'ONLY_ON_DEVICE', 'unavailable')).toMatchObject({ ok: false, code: 'unavailable' });
  });
  it('PO-11 and PO-12: drafts only from approved text', () => {
    for (const a of ['available', 'unavailable', 'no-api'] as const) {
      expect(route('draft', 'approved', 'PREFER_IN_CLOUD', a)).toEqual({ ok: true, mode: 'PREFER_IN_CLOUD' });
    }
    expect(route('draft', 'own', 'PREFER_IN_CLOUD', 'available')).toMatchObject({ ok: false, code: 'cloud-not-allowed' });
  });
  it('PO-13: an own photo needs image availability', () => {
    expect(route('caption', 'own', 'ONLY_ON_DEVICE', 'available', { image: 'unavailable', isImage: true })).toMatchObject({ ok: false, code: 'unavailable' });
  });
});

describe('hasFreshConsent (PO-14)', () => {
  it('real data consent lasts 10 minutes; the Playground keeps it; an empty list is false', async () => {
    const now = 1_800_000_000_000;
    const db = fakeDb({ consents: [{ recordId: 'upload:a', cloudAllowedAt: now - 11 * 60 * 1000 }] });
    expect(await hasFreshConsent({ allowed: true, db, maxAgeMs: 10 * 60 * 1000 }, ['upload:a'], now)).toBe(false);
    expect(await hasFreshConsent({ allowed: true, db, maxAgeMs: null }, ['upload:a'], now)).toBe(true);
    expect(await hasFreshConsent({ allowed: true, db, maxAgeMs: null }, [], now)).toBe(false);
    expect(await hasFreshConsent({ allowed: true, db, maxAgeMs: null }, ['upload:a', 'upload:b'], now)).toBe(false);
    expect(await hasFreshConsent({ allowed: true, db: bareDb(), maxAgeMs: null }, ['upload:a'], now)).toBe(false);
  });
});
