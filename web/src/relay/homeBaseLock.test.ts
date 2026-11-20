import { describe, expect, it, vi } from 'vitest';
import { acquireHomeBaseLock, lockName, type LockEnv } from './homeBaseLock';

/** A small Web Locks double: one holder per name, a FIFO queue, steal preempts the holder. */
class FakeLocks {
  holder: { reject: (e: unknown) => void } | null = null;
  queue: { cb: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal }[] = [];
  name = '';
  query = vi.fn(async () => ({ held: this.holder ? [{ name: this.name, mode: 'exclusive' as const }] : [], pending: [] }));
  request(name: string, options: LockOptions, cb: () => Promise<unknown>): Promise<unknown> {
    this.name = name;
    return new Promise((resolve, reject) => {
      const item = { cb, resolve, reject, signal: options.signal };
      if (options.steal) {
        const old = this.holder;
        this.holder = null;
        old?.reject(Object.assign(new Error('stolen'), { name: 'AbortError' }));
        this.grant(item);
        return;
      }
      options.signal?.addEventListener('abort', () => {
        const i = this.queue.indexOf(item);
        if (i >= 0) {
          this.queue.splice(i, 1);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }
      });
      if (!this.holder) this.grant(item);
      else this.queue.push(item);
    });
  }
  private grant(item: { cb: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }) {
    const me = { reject: item.reject };
    this.holder = me;
    void item.cb().then((v) => {
      if (this.holder === me) {
        this.holder = null;
        item.resolve(v);
        const next = this.queue.shift();
        if (next) this.grant(next);
      }
    });
  }
}

class Bus {
  channels: { onmessage: ((ev: MessageEvent) => void) | null; closed: boolean }[] = [];
  make = () => {
    const ch = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      closed: false,
      postMessage: (data: unknown) => {
        for (const other of this.channels) if (other !== ch && !other.closed) other.onmessage?.({ data } as MessageEvent);
      },
      close: () => {
        ch.closed = true;
      },
    };
    this.channels.push(ch);
    return ch;
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function tab(locks: FakeLocks, bus: Bus, tabId: string) {
  const h = { onAcquired: vi.fn(), onLost: vi.fn(), onWaiting: vi.fn() };
  const env: LockEnv = { locks: locks as unknown as LockEnv['locks'], channel: bus.make, tabId };
  const handle = acquireHomeBaseLock('u1', h, env);
  return { h, handle };
}

describe('home base lock', () => {
  it('names the lock per account', () => {
    expect(lockName('u1')).toBe('sieve-home-base:u1');
  });

  it('the first tab is active; a second tab waits in standby', async () => {
    const locks = new FakeLocks();
    const bus = new Bus();
    const a = tab(locks, bus, 'A');
    await flush();
    expect(a.h.onAcquired).toHaveBeenCalledTimes(1);
    const b = tab(locks, bus, 'B');
    await flush();
    expect(b.h.onWaiting).toHaveBeenCalledTimes(1);
    expect(b.h.onAcquired).not.toHaveBeenCalled();
    a.handle.cancel();   // the first tab closes
    await flush();
    expect(b.h.onAcquired).toHaveBeenCalledTimes(1);
  });

  it('steal: the other tab learns it lost the lock once, and queues again', async () => {
    const locks = new FakeLocks();
    const bus = new Bus();
    const a = tab(locks, bus, 'A');
    await flush();
    const b = tab(locks, bus, 'B');
    await flush();
    b.handle.steal();
    await flush();
    expect(b.h.onAcquired).toHaveBeenCalledTimes(1);
    expect(a.h.onLost).toHaveBeenCalledTimes(1);
    b.handle.cancel();
    await flush();
    expect(a.h.onAcquired).toHaveBeenCalledTimes(2);   // took over when the other closed
  });
});
