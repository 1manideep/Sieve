// 20 section 13.1: the queue's lanes run one at a time in a fixed order (embed, label, privacy, caption), with a rest
// after every job that ran a model: 1,000 ms after a Nano batch, 250 ms after an embed batch, 100 ms between privacy
// items. Fake timers, real pacing constants.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBED_REST_MS, NANO_REST_MS, PRIVACY_REST_MS, QUEUE_PACING } from '../config';
import { restAfter, runSerial, sleep, type JobResult, type Lane } from './serial';

interface Harness {
  jobs: { lane: Lane; at: number }[];
  work: Record<Lane, number>;
  held: boolean;
  wake: () => void;
  stop: () => void;
  done: Promise<void>;
}

function harness(
  work: Partial<Record<Lane, number>>,
  opts: { result?: (lane: Lane) => JobResult; jobMs?: number; onJob?: (lane: Lane, h: Harness) => void; urgent?: Partial<Record<Lane, number>> } = {},
): Harness {
  const urgent: Record<Lane, number> = { label: 0, embed: 0, privacy: 0, caption: 0, ...opts.urgent };
  const controller = new AbortController();
  let waker: (() => void) | null = null;
  const h: Harness = {
    jobs: [],
    work: { label: 0, embed: 0, privacy: 0, caption: 0, ...work },
    held: false,
    wake: () => {
      const w = waker;
      waker = null;
      w?.();
    },
    stop: () => {
      controller.abort();
      h.wake();
    },
    done: Promise.resolve(),
  };
  h.done = runSerial({
    signal: controller.signal,
    held: () => h.held,
    runnable: (lane) => h.work[lane] > 0,
    urgent: (lane) => urgent[lane] > 0,
    async run(lane) {
      h.jobs.push({ lane, at: Date.now() });
      if (urgent[lane] > 0) urgent[lane] -= 1;
      opts.onJob?.(lane, h);
      if (opts.jobMs) await new Promise((r) => setTimeout(r, opts.jobMs));
      h.work[lane] -= 1;
      return opts.result?.(lane) ?? 'ran';
    },
    waitForWork: () => new Promise<void>((resolve) => {
      waker = resolve;
      controller.signal.addEventListener('abort', () => resolve(), { once: true });
    }),
  });
  return h;
}

/** Stops the loop; a pending yield is a 0 ms timer, so the clock moves a little before the loop can end. */
async function finish(h: Harness): Promise<void> {
  h.stop();
  await vi.advanceTimersByTimeAsync(5);
  await h.done;
}

/** The time between one job's start and the next one's: its rest, plus the 0 ms yield. */
function gaps(h: Harness): number[] {
  return h.jobs.slice(1).map((j, i) => j.at - h.jobs[i]!.at);
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  QUEUE_PACING.nanoRestMs = NANO_REST_MS;
  QUEUE_PACING.embedRestMs = EMBED_REST_MS;
  QUEUE_PACING.privacyRestMs = PRIVACY_REST_MS;
});

afterEach(() => {
  vi.useRealTimers();
  QUEUE_PACING.nanoRestMs = 0;
  QUEUE_PACING.embedRestMs = 0;
  QUEUE_PACING.privacyRestMs = 0;
});

describe('the serial loop (20 section 13.1)', () => {
  it('the named rests: 1,000 ms after Nano, 250 ms after embed, 100 ms between privacy items', () => {
    expect([NANO_REST_MS, EMBED_REST_MS, PRIVACY_REST_MS]).toEqual([1_000, 250, 100]);
    expect((['embed', 'label', 'privacy', 'caption'] as Lane[]).map(restAfter)).toEqual([250, 1_000, 100, 1_000]);
  });

  it('runs the lanes one at a time in a fixed order, resting after every job', async () => {
    const h = harness({ caption: 1, privacy: 2, embed: 2, label: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.jobs.map((j) => j.lane)).toEqual(['embed', 'embed', 'label', 'label', 'privacy', 'privacy', 'caption']);
    // each start is the previous start plus its rest (the yield is a 0 ms timer, at most a millisecond or two)
    const want = [250, 250, 1_000, 1_000, 100, 100];
    gaps(h).forEach((g, i) => {
      expect(g).toBeGreaterThanOrEqual(want[i]!);
      expect(g).toBeLessThan(want[i]! + 5);
    });
    await finish(h);
  });

  it('the next job waits out the whole rest', async () => {
    const h = harness({ label: 2 });
    await vi.advanceTimersByTimeAsync(990);
    expect(h.jobs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15);
    expect(h.jobs).toHaveLength(2);
    expect(gaps(h)[0]).toBeGreaterThanOrEqual(1_000);
    await finish(h);
  });

  it('never two jobs at once, and work that arrives for an earlier lane goes next', async () => {
    let running = 0;
    let most = 0;
    const h = harness({ label: 2, caption: 1 }, {
      jobMs: 50,
      onJob: (lane, hh) => {
        running += 1;
        most = Math.max(most, running);
        setTimeout(() => (running -= 1), 50);
        if (lane === 'label' && hh.work.embed === 0 && hh.jobs.length === 1) hh.work.embed = 1;   // new items arrive mid-label
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.jobs.map((j) => j.lane)).toEqual(['label', 'embed', 'label', 'caption']);
    expect(most).toBe(1);
    await finish(h);
  });

  it('no rest after a job that ran no model; a lane with nothing it can run gives way to the next', async () => {
    const h = harness({ label: 1, embed: 1 }, { result: (lane) => (lane === 'embed' ? 'quick' : 'ran') });
    await vi.advanceTimersByTimeAsync(5);
    expect(h.jobs.map((j) => j.lane)).toEqual(['embed', 'label']);
    expect(gaps(h)[0]).toBeLessThan(5);                    // a yield, no rest
    await finish(h);

    let first = true;
    const none = harness({ label: 1, embed: 1 }, {
      result: (lane) => {
        if (lane === 'embed' && first) {
          first = false;
          return 'none';
        }
        return 'ran';
      },
    });
    none.work.embed += 1;                                 // 'none' leaves the item queued
    await vi.advanceTimersByTimeAsync(0);
    expect(none.jobs.map((j) => j.lane)).toEqual(['embed', 'label']);
    expect(gaps(none)).toEqual([0]);                       // 'none' moves on at once: no yield, no rest
    await finish(none);
  });

  it('holds while paused or on battery, and goes on after a wake', async () => {
    const h = harness({});
    h.held = true;
    h.work.label = 1;
    h.wake();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.jobs).toHaveLength(0);
    h.held = false;
    h.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jobs.map((j) => j.lane)).toEqual(['label']);
    await finish(h);
  });

  it('work a person waits for goes first, with no rest; then the bulk resumes its pace', async () => {
    const h = harness({ label: 2, embed: 2, privacy: 2 }, { urgent: { label: 1, embed: 1, privacy: 1 } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.jobs.map((j) => j.lane)).toEqual(['embed', 'label', 'privacy', 'embed', 'label', 'privacy']);
    const g = gaps(h);
    expect(g.slice(0, 3).every((x) => x < 5)).toBe(true);          // the person's item: searchable, sorted, checked at once
    expect(g[3]).toBeGreaterThanOrEqual(250);                        // the bulk embed batch rests again
    expect(g[4]).toBeGreaterThanOrEqual(1_000);                      // and the bulk label batch
    await finish(h);
  });

  it('stop ends a rest at once', async () => {
    const h = harness({ label: 2 });
    await vi.advanceTimersByTimeAsync(10);
    await finish(h);
    expect(h.jobs).toHaveLength(1);
    expect(Date.now()).toBeLessThan(1_000);
  });
});

describe('sleep on a long-lived signal', () => {
  it('removes its abort listener when the time is up, so the queue signal does not collect one per rest', async () => {
    const ctl = new AbortController();
    const add = vi.spyOn(ctl.signal, 'addEventListener');
    const remove = vi.spyOn(ctl.signal, 'removeEventListener');
    for (let i = 0; i < 5; i++) {
      const p = sleep(100, ctl.signal);
      await vi.advanceTimersByTimeAsync(100);
      await p;
    }
    expect(add).toHaveBeenCalledTimes(5);
    expect(remove).toHaveBeenCalledTimes(5);
    // and an abort still ends a sleep at once
    const p = sleep(10_000, ctl.signal);
    ctl.abort();
    await p;
  });
});
