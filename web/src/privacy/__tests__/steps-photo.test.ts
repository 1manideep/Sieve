// AT-STEP-15 (text side): the place is never in photo text; names in the caption are hidden. The image re-encoding
// and its EXIF check run in a real browser (manual check); here preparePhotoForShare is mocked in one test and real
// (and failing closed, since this environment cannot decode images) in the other.
import type { IndexRecord } from '@sieve/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { setPrivacyModelHost } from '../model/client';
import { recordTextHash } from '../scan/scan';
import { buildStepOption } from '../steps/build';
import * as photo from '../steps/photo';

const ai = vi.hoisted(() => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));
vi.mock('../../ai', () => ai);

const CAPTION = 'Chris eating five hot dogs at a backyard party';
const stamp = (version: string, ran: 'code' | 'device') => ({ version, ran, ms: 0, at: 0 });
function photoRecord(): IndexRecord {
  const base = {
    id: 'playground:pg-photo-01', source: 'playground', sourceRef: 'pg-photo-01', kind: 'photo', title: 'IMG_4821.jpg', date: Date.UTC(2025, 6, 4, 18),
    preview: CAPTION, caption: CAPTION, captionBy: 'seed', photo: { takenAt: Date.UTC(2025, 6, 4, 18), place: 'Austin', width: 1600, height: 1200, mime: 'image/jpeg', hadGps: true },
    category: 'Photos', categoryBy: 'seed', hiddenRemoved: [], pii: [{ start: 0, end: 5, type: 'name', by: 'model', score: 0.9 }],
    injection: { suspicious: false, by: 'code' }, sizeBytes: 1, indexedAt: 0, contentHash: 'h', version: 1,
  } as IndexRecord;
  base.privacyScan = {
    textHash: recordTextHash(base), headerEntities: [],
    pii: { validators: stamp('validators@1', 'code'), model: stamp('rampart@b1993e4+minscore0.4', 'device'), nano: stamp('nano-pii@1', 'device') },
    injection: { code: stamp('patterns@1', 'code'), nano: stamp('nano-injection@1', 'device') },
  };
  return base;
}

beforeEach(() => {
  setPrivacyModelHost(null);
  ai.getNanoAvailability.mockResolvedValue({ text: 'available', image: 'available' });
  vi.restoreAllMocks();
});

describe('photos', () => {
  test('AT-STEP-15 full: no place name, caption names hidden, the stripped image attached', async () => {
    const image = { mime: 'image/jpeg' as const, base64: 'AAAA', width: 1600, height: 1200, bytes: 3 };
    vi.spyOn(photo, 'preparePhotoForShare').mockResolvedValue({ ok: true, image, removed: ['location', 'camera'] });
    const full = await buildStepOption('full', {}, photoRecord(), 'sample', { photo: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(full.available).toBe(true);
    expect(full.text).toBe('Photo, taken Jul 4, 2025 (1600×1200). Caption: [name] eating five hot dogs at a backyard party\n[Image attached. Location and camera details were removed.]');
    expect(full.text).not.toContain('Austin');
    expect(full.image).toEqual(image);
  });
  test('excerpt and answer', async () => {
    const rec = photoRecord();
    const excerpt = await buildStepOption('excerpt', { excerpt: CAPTION }, rec, 'sample');
    expect(excerpt.text).toBe('Photo caption (Jul 4, 2025): [name] eating five hot dogs at a backyard party');
    const answer = await buildStepOption('answer', { answer: 'It was taken on July 4, 2025.' }, rec, 'sample');
    expect(answer.text).toBe('It was taken on July 4, 2025.');
  });
  test('full without the photo blob is unavailable', async () => {
    const full = await buildStepOption('full', {}, photoRecord(), 'sample');
    expect(full.unavailableReason).toBe('This photo is not available to share.');
  });
  test('a photo that cannot be re-encoded is not offered (fail closed)', async () => {
    const full = await buildStepOption('full', {}, photoRecord(), 'sample', { photo: new Blob(['not an image'], { type: 'image/jpeg' }) });
    expect(full.available).toBe(false);
    expect(full.unavailableReason).toBe('This photo format cannot be prepared for sharing.');
  });
});
