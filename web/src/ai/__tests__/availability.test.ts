import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_CREATE_OPTIONS, TEXT_CREATE_OPTIONS } from '../config';
import { getNanoAvailability, getNanoState, setNanoSimulation, subscribeNano } from '../device/availability';
import { setLanguageModelForTests } from '../device/languageModel';
import { baseSessionCount } from '../device/sessions';
import { downloadNano, NanoSetupError } from '../device/setup';
import { installNanoWatchers } from '../device/watchers';
import { LABEL_SYSTEM, SELECT_SYSTEM, VERIFY_SYSTEM } from '../prompts';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';

function setActivation(isActive: boolean | undefined): void {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: isActive === undefined ? undefined : { isActive, hasBeenActive: isActive },
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('availability (10 section 16.1)', () => {
  beforeEach(() => resetAiForTests());
  afterEach(() => {
    vi.useRealTimers();
    setActivation(undefined);
  });

  it('AV-1: no LanguageModel global gives no-api', async () => {
    setLanguageModelForTests(undefined);
    expect(await getNanoAvailability()).toEqual({ text: 'no-api', image: 'no-api' });
  });

  it('AV-2: text and image checked with exactly the create options', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'unavailable' } });
    setLanguageModelForTests(lm);
    expect(await getNanoAvailability()).toEqual({ text: 'available', image: 'unavailable' });
    expect(lm.availabilityOptions).toContain(TEXT_CREATE_OPTIONS);
    expect(lm.availabilityOptions).toContain(IMAGE_CREATE_OPTIONS);
    expect(lm.availabilityOptions).toHaveLength(2);
  });

  it('AV-3: a throw or an unknown value counts as unavailable', async () => {
    setLanguageModelForTests(
      installFakeLanguageModel({
        availability: (o) => {
          if ((o?.expectedInputs ?? []).some((i) => i.type === 'image')) throw new Error('boom');
          return 'readily';
        },
      }),
    );
    expect(await getNanoAvailability()).toEqual({ text: 'unavailable', image: 'unavailable' });
  });

  it('AV-4: results are cached for 5 s; maxAgeMs 0 forces a check', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 16, 12, 0, 0));
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'available' } });
    setLanguageModelForTests(lm);
    await getNanoAvailability();
    vi.setSystemTime(new Date(2026, 10, 16, 12, 0, 1));
    await getNanoAvailability();
    await getNanoAvailability({ maxAgeMs: 0 });
    expect(lm.counters.availabilityCalls).toBe(4);   // 2 rounds of (text, image)
  });

  it('AV-5: simulation lowers availability and is reported', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
    const seen: boolean[] = [];
    subscribeNano((s) => seen.push(s.simulated));
    setNanoSimulation(true);
    expect(await getNanoAvailability({ maxAgeMs: 0 })).toEqual({ text: 'unavailable', image: 'unavailable' });
    expect(getNanoState().simulated).toBe(true);
    setNanoSimulation(false);
    expect(await getNanoAvailability()).toEqual({ text: 'available', image: 'available' });
    expect(seen).toContain(true);
    expect(getNanoState()).toMatchObject({ text: 'available', simulated: false });
  });
});

describe('downloadNano (10 section 7.3)', () => {
  beforeEach(() => resetAiForTests());
  afterEach(() => setActivation(undefined));

  it('AV-6: without user activation it rejects needs-click and never calls create', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'downloadable', image: 'downloadable' } });
    setLanguageModelForTests(lm);
    setActivation(false);
    await expect(downloadNano()).rejects.toMatchObject({ code: 'needs-click' });
    await expect(downloadNano()).rejects.toBeInstanceOf(NanoSetupError);
    expect(lm.counters.creates).toBe(0);
  });

  it('AV-7: reports progress, destroys the download session and re-checks availability', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'downloadable', image: 'downloadable' }, progress: [0.25, 0.5, 1] });
    setLanguageModelForTests(lm);
    setActivation(true);
    const fractions: number[] = [];
    const stateFractions: (number | null)[] = [];
    subscribeNano((s) => stateFractions.push(s.setupFraction));
    const done = downloadNano({ onProgress: (f) => fractions.push(f) });
    lm.setAvailability({ text: 'available', image: 'downloadable' });
    await done;
    expect(fractions).toEqual([0.25, 0.5, 1]);
    expect(stateFractions).toContain(0.5);
    expect(getNanoState().setupFraction).toBeNull();
    expect(lm.counters.destroys).toBeGreaterThanOrEqual(1);
    expect(getNanoState().text).toBe('available');
    expect(lm.createOptions[0].expectedInputs).toEqual(TEXT_CREATE_OPTIONS.expectedInputs);
  });

  it('AV-8: QuotaExceededError maps to no-space with the 22 GB message', async () => {
    setLanguageModelForTests(
      installFakeLanguageModel({ availability: { text: 'downloadable', image: 'downloadable' }, createError: new DOMException('full', 'QuotaExceededError') }),
    );
    setActivation(true);
    await expect(downloadNano()).rejects.toMatchObject({
      code: 'no-space',
      message: 'Chrome needs about 22 GB of free disk space to set up Gemini Nano.',
    });
  });

  it('maps NotSupportedError and other failures; no API gives no-api', async () => {
    setActivation(true);
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'unavailable', image: 'unavailable' }, createError: new DOMException('x', 'NotSupportedError') }));
    await expect(downloadNano()).rejects.toMatchObject({ code: 'unavailable' });
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'downloadable', image: 'downloadable' }, createError: new Error('network') }));
    await expect(downloadNano()).rejects.toMatchObject({ code: 'failed' });
    setLanguageModelForTests(undefined);
    await expect(downloadNano()).rejects.toMatchObject({ code: 'no-api' });
  });
});

describe('watchers (10 section 7.7)', () => {
  let uninstall: (() => void) | undefined;
  beforeEach(() => resetAiForTests());
  afterEach(() => uninstall?.());

  it('AV-9: the first pointerdown warms select, then verify, then label; a second creates nothing', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'unavailable' } });
    setLanguageModelForTests(lm);
    uninstall = installNanoWatchers();
    window.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(lm.counters.creates).toBe(3));
    expect(lm.createOptions[0].initialPrompts).toEqual([{ role: 'system', content: SELECT_SYSTEM }]);
    expect(lm.createOptions[1].initialPrompts).toEqual([{ role: 'system', content: VERIFY_SYSTEM }]);
    expect(lm.createOptions[2].initialPrompts).toEqual([{ role: 'system', content: LABEL_SYSTEM }]);
    window.dispatchEvent(new Event('pointerdown'));
    await flush();
    await flush();
    expect(lm.counters.creates).toBe(3);
    expect(baseSessionCount()).toBe(3);
  });

  it('pagehide drops the warm sessions; focus re-checks availability', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'unavailable' } });
    setLanguageModelForTests(lm);
    uninstall = installNanoWatchers();
    window.dispatchEvent(new Event('keydown'));
    await vi.waitFor(() => expect(baseSessionCount()).toBe(3));
    window.dispatchEvent(new Event('pagehide'));
    expect(baseSessionCount()).toBe(0);
    const before = lm.counters.availabilityCalls;
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(lm.counters.availabilityCalls).toBe(before + 2));
  });
});
