import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexRecord } from '@sieve/shared';
import { labelBatch, selectAndAnswer } from '@/ai';
import { TIMING } from '@/ai/config';
import { setLanguageModelForTests } from '@/ai/device/languageModel';
import { setHybridForTests } from '@/ai/hybrid';
import { createFakeHybrid, fakeSleep, promptText } from '@/ai/testing/fakeHybrid';
import { installFakeLanguageModel } from '@/ai/testing/fakeLanguageModel';
import { resetAiForTests } from '@/ai/testing/reset';
import { bareDb, consentRows, fakeDb } from '@/ai/__tests__/fakeDb';
import { RECORDS, record } from '@/ai/__tests__/fixtures';
import { clearCloudConsentRequestsForTests, getCloudConsentRequest, grantCloudConsent } from '../consent';
import { forgetEnrichmentForTests, needsWork, nudgeEnrichment, startEnrichment } from '../enrich';
import * as idx from './mocks/index';

vi.mock('@/index', () => import('./mocks/index'));
vi.mock('@/privacy', () => import('./mocks/privacy'));

const ready = { text: 'available' as const, image: 'available' as const };

describe('enrichment names (01 section 11.1) and needsWork (10 section 11)', () => {
  beforeEach(() => {
    resetAiForTests();
    forgetEnrichmentForTests();
    idx.resetIndexMock();
  });

  it('startEnrichment is a thin wrapper over 20\'s startIngestQueue; a nudge restarts the started queues', () => {
    const db = fakeDb();
    const queue = startEnrichment(db, { kind: 'playground' });
    expect(idx.startIngestQueue).toHaveBeenCalledWith(db);
    expect(queue).toBe(idx.fakeQueue);
    nudgeEnrichment();
    expect(idx.fakeQueue.start).toHaveBeenCalledTimes(1);
  });

  it('labels run for code labels, low confidence and old versions; seeds never re-run', () => {
    const base = record({ id: 'gmail:a', title: 'x', categoryBy: 'rule' });
    expect(needsWork(base, 'label', ready)).toBe(true);
    expect(needsWork(base, 'label', { text: 'unavailable', image: 'unavailable' })).toBe(false);
    const done = { ...base, categoryBy: 'device', enrich: { label: { v: 1, by: 'device', at: 1, confidence: 'high', attempts: 1 } } } as IndexRecord;
    expect(needsWork(done, 'label', ready)).toBe(false);
    const low = { ...done, enrich: { label: { v: 1, by: 'device', at: 1, confidence: 'low', attempts: 1 } } } as IndexRecord;
    expect(needsWork(low, 'label', ready)).toBe(true);
    const tried = { ...done, enrich: { label: { v: 1, by: 'code', at: 1, attempts: 2 } } } as IndexRecord;
    expect(needsWork(tried, 'label', ready)).toBe(false);
    expect(needsWork(RECORDS.deposit, 'label', ready)).toBe(false);   // seeded
    const photo = record({ id: 'upload:p', title: 'p.jpg', kind: 'photo', categoryBy: 'rule' });
    expect(needsWork(photo, 'caption', ready)).toBe(true);
    expect(needsWork(photo, 'caption', { text: 'available', image: 'unavailable' })).toBe(false);
    expect(needsWork({ ...photo, caption: 'A cat.', captionBy: 'seed' }, 'caption', ready)).toBe(false);
  });

  it('EN-4: a running label batch is preempted by a question, and runs again afterwards', async () => {
    TIMING.backgroundResumeDelayMs = 30;
    setLanguageModelForTests(installFakeLanguageModel({ availability: ready }));
    const order: string[] = [];
    let labelRuns = 0;
    setHybridForTests(
      createFakeHybrid(async (spec, parts, { signal }) => {
        if (spec.purpose === 'label') {
          labelRuns += 1;
          order.push(`label-start-${labelRuns}`);
          await fakeSleep(labelRuns === 1 ? 500 : 10, signal);
          order.push(`label-end-${labelRuns}`);
          return { text: '{"labels":[{"i":1,"c":"Home"}]}', source: 'on_device' };
        }
        order.push('select');
        expect(promptText(parts)).toContain('Question:');
        return { text: '{"item":"P1","answer":"Your deposit was $1,200."}', source: 'on_device' };
      }),
    );
    const item = { id: 'gmail:a', title: 'Re: Deposit for the apartment', from: 'Oakview', preview: 'Deposit received.', kind: 'email' as const };
    const batch = labelBatch([item], 'own', { priority: 'background' });
    await fakeSleep(50, new AbortController().signal);
    const answer = await selectAndAnswer('deposit', [RECORDS.deposit], 'own');
    expect(answer.ok).toBe(true);
    const labelled = await batch;
    expect(labelled.labels['gmail:a']).toBe('Home');
    expect(labelled.by?.['gmail:a']).toBe('device');
    expect(order).toEqual(['label-start-1', 'select', 'label-start-2', 'label-end-2']);
  });
});

describe('cloud consent store (10 section 12.5)', () => {
  beforeEach(() => clearCloudConsentRequestsForTests());

  it('grantCloudConsent writes one row per record; old requests are forgotten', async () => {
    const db = fakeDb();
    await grantCloudConsent(db, ['upload:a', 'upload:b'], 1000);
    expect(consentRows(db)).toEqual([
      { recordId: 'upload:a', cloudAllowedAt: 1000 },
      { recordId: 'upload:b', cloudAllowedAt: 1000 },
    ]);
    expect(getCloudConsentRequest('nothing')).toBeUndefined();
    await expect(grantCloudConsent(bareDb(), ['a'])).rejects.toThrow('consents store');
  });
});
