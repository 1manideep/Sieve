import { beforeEach, describe, expect, it } from 'vitest';
import { TIMING } from '../config';
import { currentDeviceCall, deviceSchedulerState, scheduleDevice } from '../device/scheduler';
import { resetAiForTests } from '../testing/reset';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An attempt that resolves after `ms`, or rejects when its signal aborts. */
function timed(ms: number, value: string, log: string[], running: { n: number; max: number }) {
  return (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      running.n += 1;
      running.max = Math.max(running.max, running.n);
      log.push(`start:${value}`);
      const id = setTimeout(() => {
        running.n -= 1;
        log.push(`end:${value}`);
        resolve(value);
      }, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        running.n -= 1;
        log.push(`abort:${value}`);
        reject(signal.reason);
      }, { once: true });
    });
}

describe('scheduler (10 section 16.4)', () => {
  beforeEach(() => {
    resetAiForTests();
    TIMING.backgroundResumeDelayMs = 60;
  });

  it('SC-1: foreground first, then background in order, never two at once', async () => {
    const log: string[] = [];
    const running = { n: 0, max: 0 };
    const b1 = scheduleDevice('background', undefined, timed(10, 'b1', log, running));
    const b2 = scheduleDevice('background', undefined, timed(10, 'b2', log, running));
    const f = scheduleDevice('foreground', undefined, timed(10, 'f', log, running));
    expect(await Promise.all([f, b1, b2])).toEqual(['f', 'b1', 'b2']);
    expect(log.filter((l) => l.startsWith('end'))).toEqual(['end:f', 'end:b1', 'end:b2']);
    expect(running.max).toBe(1);
  });

  it('SC-2: a foreground job preempts a running background job, which runs again later', async () => {
    const log: string[] = [];
    const running = { n: 0, max: 0 };
    let bgRuns = 0;
    let preemptReason: unknown;
    const bg = scheduleDevice('background', undefined, (signal) => {
      bgRuns += 1;
      const run = bgRuns;
      signal.addEventListener('abort', () => { preemptReason = signal.reason; }, { once: true });
      return timed(run === 1 ? 1000 : 20, `bg${run}`, log, running)(signal);
    });
    await sleep(100);
    let fgStartedAt = 0;
    const fg = scheduleDevice('foreground', undefined, async (signal) => {
      fgStartedAt = performance.now();
      return timed(30, 'fg', log, running)(signal);
    });
    const abortedAt = performance.now();
    const fgEndedAt = await fg.then(() => performance.now());
    expect(preemptReason).toBeInstanceOf(DOMException);
    expect((preemptReason as DOMException).name).toBe('AbortError');
    expect((preemptReason as DOMException).message).toBe('Preempted');
    expect(fgStartedAt - abortedAt).toBeLessThan(50);
    const result = await bg;
    const bgSecondStart = performance.now();
    expect(result).toBe('bg2');
    expect(bgRuns).toBe(2);
    expect(bgSecondStart - fgEndedAt).toBeGreaterThanOrEqual(TIMING.backgroundResumeDelayMs - 5);
    expect(deviceSchedulerState().preemptions).toBe(1);
    expect(running.max).toBe(1);
  });

  it('SC-3: foreground never preempts foreground', async () => {
    const log: string[] = [];
    const running = { n: 0, max: 0 };
    const a = scheduleDevice('foreground', undefined, timed(40, 'a', log, running));
    await sleep(10);
    const b = scheduleDevice('foreground', undefined, timed(10, 'b', log, running));
    await Promise.all([a, b]);
    expect(log).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('SC-4: a queued job whose caller aborts rejects and never runs', async () => {
    const log: string[] = [];
    const running = { n: 0, max: 0 };
    const first = scheduleDevice('foreground', undefined, timed(40, 'first', log, running));
    const ctl = new AbortController();
    const queued = scheduleDevice('foreground', ctl.signal, timed(10, 'queued', log, running));
    ctl.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await first;
    expect(log).not.toContain('start:queued');
  });

  it('SC-5: currentDeviceCall describes the running attempt only', async () => {
    let seen: ReturnType<typeof currentDeviceCall> = null;
    await scheduleDevice('foreground', undefined, async (signal) => {
      seen = currentDeviceCall();
      expect(seen?.signal).toBe(signal);
      return 1;
    });
    expect(seen).toMatchObject({ priority: 'foreground' });
    expect(currentDeviceCall()).toBeNull();
  });
});
