// A per-page quota bucket for Gmail (20 section 15.2): units refill continuously, interactive callers first,
// at most maxConcurrency requests in flight.

interface Waiter { units: number; priority: 'interactive' | 'background'; resolve: (release: () => void) => void; reject: (e: unknown) => void; signal?: AbortSignal }

export class UnitBucket {
  private tokens: number;
  private last: number;
  private inFlight = 0;
  private waiters: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly perMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: { unitsPerMinute: number; capacity: number; maxConcurrency: number; now?: () => number }) {
    this.now = opts.now ?? (() => Date.now());
    this.perMs = opts.unitsPerMinute / 60_000;
    this.tokens = opts.capacity;
    this.last = this.now();
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.opts.capacity, this.tokens + (t - this.last) * this.perMs);
    this.last = t;
  }

  acquire(units: number, priority: 'interactive' | 'background', signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const w: Waiter = { units: Math.min(units, this.opts.capacity), priority, resolve, reject, signal };
      if (priority === 'interactive') {
        const firstBg = this.waiters.findIndex((x) => x.priority === 'background');
        if (firstBg < 0) this.waiters.push(w);
        else this.waiters.splice(firstBg, 0, w);
      } else {
        this.waiters.push(w);
      }
      signal?.addEventListener('abort', () => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new DOMException('Aborted', 'AbortError'));
        }
      }, { once: true });
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.refill();
    while (this.waiters.length > 0 && this.inFlight < this.opts.maxConcurrency) {
      const w = this.waiters[0] as Waiter;
      if (this.tokens < w.units) break;
      this.waiters.shift();
      this.tokens -= w.units;
      this.inFlight++;
      let released = false;
      w.resolve(() => {
        if (released) return;
        released = true;
        this.inFlight--;
        this.pump();
      });
    }
    const head = this.waiters[0];
    if (head && this.inFlight < this.opts.maxConcurrency) {
      const wait = Math.max(1, Math.ceil((head.units - this.tokens) / this.perMs));
      this.timer = setTimeout(() => this.pump(), wait);
    }
  }
}
