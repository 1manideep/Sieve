import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageModelForTests } from '../device/languageModel';
import { setHybridForTests } from '../hybrid';
import { captionPhoto, toJpegPart } from '../tasks/caption';
import { DEFAULT_DRAFT_INSTRUCTION, draftReply } from '../tasks/draft';
import { createFakeHybrid, promptText } from '../testing/fakeHybrid';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';

const canvases: { width: number; height: number; type?: string; quality?: number }[] = [];

function stubImageApis(width = 4000, height = 3000) {
  canvases.length = 0;
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close: vi.fn() })));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { drawImage: vi.fn() };
      }
      async convertToBlob(opts: { type: string; quality: number }) {
        canvases.push({ width: this.width, height: this.height, type: opts.type, quality: opts.quality });
        return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: opts.type });
      }
    },
  );
}

describe('captionPhoto (10 section 16.8)', () => {
  beforeEach(() => resetAiForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('CA-1: an own photo without image support is refused before any call', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'unavailable' } }));
    const fake = createFakeHybrid(() => ({ text: '{"caption":"x"}', source: 'on_device' }));
    setHybridForTests(fake);
    const res = await captionPhoto(new Blob(['x'], { type: 'image/png' }), 'own', { recordId: 'folder:a.png' });
    expect(!res.ok && res.error.code).toBe('unavailable');
    expect(fake.calls).toHaveLength(0);
  });

  it('CA-2: a 4000 by 3000 PNG is sent as a 1024 by 768 JPEG', async () => {
    stubImageApis();
    const part = await toJpegPart(new Blob(['png'], { type: 'image/png' }));
    expect(part.inlineData.mimeType).toBe('image/jpeg');
    expect(canvases[0]).toMatchObject({ width: 1024, height: 768, type: 'image/jpeg', quality: 0.85 });
    expect(atob(part.inlineData.data)).toBe('\xff\xd8\xff\xd9');
    expect(part.bytes).toBe(4);
  });

  it('CA-3: a long caption is cut to its first sentence, at most 200 characters', async () => {
    stubImageApis(800, 600);
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
    const long = `A dog playing in a park. It is sunny${' and bright'.repeat(20)}.`;
    expect(long.length).toBeGreaterThanOrEqual(250);
    const fake = createFakeHybrid(() => ({ text: JSON.stringify({ caption: long }), source: 'on_device' }));
    setHybridForTests(fake);
    const res = await captionPhoto(new Blob(['x'], { type: 'image/png' }), 'sample', { recordId: 'playground:p' });
    expect(res.ok && res.value.caption).toBe('A dog playing in a park.');
    expect(res.trace).toMatchObject({ where: 'device', label: 'Described this photo on this device', charsSent: 0 });
    expect(fake.calls[0].spec.image).toBe(true);
    expect(fake.calls[0].parts[1]).toHaveProperty('inlineData');
  });

  it('a sample photo without Nano is described in the cloud, and says the photo left', async () => {
    stubImageApis(800, 600);
    setLanguageModelForTests(undefined);
    setHybridForTests(createFakeHybrid(() => ({ text: '{"caption":"A cat on a sofa."}', source: 'in_cloud' })));
    const res = await captionPhoto(new Blob(['x']), 'sample');
    expect(res.ok && res.value.caption).toBe('A cat on a sofa.');
    expect(res.trace.label).toMatch(/^Described this photo in the cloud: the photo \(\d+ KB\) left this device$/);
    expect(res.trace.charsSent).toBe(8);   // the JPEG's base64 length
  });
});

describe('draftReply (10 section 16.8)', () => {
  beforeEach(() => resetAiForTests());

  const APPROVED = 'Your deposit was $1,200, paid on March 3.';

  it('DR-1: drafts in the cloud from the approved text and instruction only', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
    const fake = createFakeHybrid(() => ({ text: 'Hi Dana, thanks for confirming.', source: 'in_cloud' }));
    setHybridForTests(fake);
    const res = await draftReply(APPROVED, 'Draft a reply.');
    const call = fake.calls[0];
    expect(call.spec).toMatchObject({ mode: 'PREFER_IN_CLOUD', cloudModel: 'gemini-3.8-flash', purpose: 'draft' });
    expect(call.meta?.data).toBe('approved');
    expect(promptText(call.parts)).toBe(`Instruction: Draft a reply.\n\nApproved text:\n<<<\n${APPROVED}\n>>>`);
    expect(res.trace).toMatchObject({ where: 'cloud', charsSent: 55 });
    expect(res.trace.label).toBe('Drafted a reply from the approved text: 55 characters of your data left this device');
  });

  it('DR-2 and DR-3: facts the draft adds are flagged; placeholders are fine', async () => {
    setLanguageModelForTests(undefined);
    setHybridForTests(createFakeHybrid(() => ({ text: 'Hi, thanks for confirming my deposit of $1,500 paid on March 3. I expect it back within 30 days.', source: 'in_cloud' })));
    const flagged = await draftReply(APPROVED, 'Draft a reply.');
    expect(flagged.ok && flagged.value.unsupported).toEqual(['$1,500', '30']);
    setHybridForTests(
      createFakeHybrid(() => ({
        text: 'Hi Dana, thanks for confirming you received my $1,200 deposit on March 3. Could you tell me when I can expect it back after I move out on [move-out date]?',
        source: 'in_cloud',
      })),
    );
    const res = await draftReply(APPROVED, 'Draft a reply.');
    expect(res.ok && res.value.unsupported).toBeUndefined();
  });

  it('DR-4: an empty instruction becomes the default one', async () => {
    const fake = createFakeHybrid(() => ({ text: 'ok', source: 'in_cloud' }));
    setHybridForTests(fake);
    await draftReply(APPROVED, '   ');
    expect(promptText(fake.calls[0].parts)).toContain(`Instruction: ${DEFAULT_DRAFT_INSTRUCTION}`);
  });

  it('refuses empty or oversized approved text without a call', async () => {
    const fake = createFakeHybrid(() => ({ text: 'ok', source: 'in_cloud' }));
    setHybridForTests(fake);
    expect((await draftReply('', 'x')).ok).toBe(false);
    expect((await draftReply('x'.repeat(8001), 'x')).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
