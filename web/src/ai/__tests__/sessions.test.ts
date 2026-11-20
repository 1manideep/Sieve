import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_BASE_SESSIONS } from '../config';
import { getNanoAvailability } from '../device/availability';
import { setLanguageModelForTests } from '../device/languageModel';
import { baseSessionCount, cloneFromBase, dropBaseSessions } from '../device/sessions';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';

const live = new AbortController().signal;

describe('warm base sessions (10 section 7.4)', () => {
  beforeEach(() => resetAiForTests());

  it('shares one creation between concurrent calls for the same key', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'available' } });
    setLanguageModelForTests(lm);
    await Promise.all([cloneFromBase({ key: 'a', image: false }, live), cloneFromBase({ key: 'a', image: false }, live)]);
    expect(lm.counters.creates).toBe(1);
    expect(lm.counters.clones).toBe(2);
  });

  it('recreates a base once when a clone fails (R-MDL-05), and a second failure propagates', async () => {
    const lm = installFakeLanguageModel({
      availability: { text: 'available', image: 'available' },
      cloneErrors: [new DOMException('gone', 'InvalidStateError')],
    });
    setLanguageModelForTests(lm);
    await cloneFromBase({ key: 'a', image: false }, live);
    expect(lm.counters.creates).toBe(2);
    const lm2 = installFakeLanguageModel({
      availability: { text: 'available', image: 'available' },
      cloneErrors: [new DOMException('x', 'InvalidStateError'), new DOMException('y', 'InvalidStateError')],
    });
    setLanguageModelForTests(lm2);
    dropBaseSessions();
    await expect(cloneFromBase({ key: 'a', image: false }, live)).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  it('never retries an aborted clone', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
    await expect(cloneFromBase({ key: 'a', image: false }, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps at most MAX_BASE_SESSIONS, evicting the least recently used', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'available' } });
    setLanguageModelForTests(lm);
    await getNanoAvailability();
    for (let i = 0; i <= MAX_BASE_SESSIONS; i += 1) await cloneFromBase({ key: `k${i}`, image: false }, live);
    expect(baseSessionCount()).toBe(MAX_BASE_SESSIONS);
    dropBaseSessions();
    expect(baseSessionCount()).toBe(0);
  });

  it('drops the bases when the model stops being available (R-MDL-03)', async () => {
    const lm = installFakeLanguageModel({ availability: { text: 'available', image: 'available' } });
    setLanguageModelForTests(lm);
    await getNanoAvailability();
    await cloneFromBase({ key: 'a', image: false }, live);
    expect(baseSessionCount()).toBe(1);
    lm.setAvailability({ text: 'downloadable', image: 'downloadable' });
    await getNanoAvailability({ maxAgeMs: 0 });
    expect(baseSessionCount()).toBe(0);
  });
});
