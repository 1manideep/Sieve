// One home base tab per account (40 section 11.3): a Web Lock named 'sieve-home-base:{uid}'.
// A queued request waits for the lock; steal() preempts the holder, which learns it from a BroadcastChannel notice
// (or its request rejecting) and queues again, so it takes over when the other tab closes.

export interface HomeBaseLock { held: boolean; release(): void }

export interface LockHandlers { onAcquired(): void; onLost(): void; onWaiting(): void }

interface LocksLike {
  request(name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>): Promise<unknown>;
  query(): Promise<LockManagerSnapshot>;
}

interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

export interface LockEnv {
  locks?: LocksLike;
  channel?: (name: string) => ChannelLike;
  tabId?: string;
}

/** A per page load id, so a tab can tell its own broadcast from another tab's. */
const TAB_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random());

export function lockName(uid: string): string {
  return 'sieve-home-base:' + uid;
}

export function locksSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

export function acquireHomeBaseLock(uid: string, handlers: LockHandlers, env: LockEnv = {}): { cancel(): void; steal(): void } {
  const locks = env.locks ?? (navigator.locks as unknown as LocksLike);
  const tabId = env.tabId ?? TAB_ID;
  const name = lockName(uid);
  const channel: ChannelLike = env.channel?.(name) ?? (new BroadcastChannel(name) as unknown as ChannelLike);
  let held = false;
  let cancelled = false;
  let release: (() => void) | null = null;
  let queued: AbortController | null = null;
  let generation = 0;

  const hold = (gen: number) => async () => {
    if (cancelled || gen !== generation) return;
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
      handlers.onAcquired();
    });
  };

  const lost = () => {
    if (!held || cancelled) return;
    held = false;
    const r = release;
    release = null;
    r?.();
    handlers.onLost();
    queue();
  };

  function queue(): void {
    if (cancelled) return;
    const gen = ++generation;
    const ctl = new AbortController();
    queued = ctl;
    void locks
      .query()
      .then((s) => {
        if (!cancelled && gen === generation && !held && (s.held ?? []).some((l) => l.name === name)) handlers.onWaiting();
      })
      .catch(() => undefined);
    locks.request(name, { signal: ctl.signal }, hold(gen)).catch((error: unknown) => {
      if (cancelled || (isAbort(error) && ctl.signal.aborted)) return;
      // A stolen lock rejects the holder's request: same handling as the broadcast.
      if (held && gen === generation) lost();
    });
  }

  channel.onmessage = (ev: MessageEvent) => {
    const data = ev.data as { type?: unknown; tabId?: unknown } | null;
    if (data?.type === 'home-base-taken' && data.tabId !== tabId) lost();
  };

  queue();

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      queued?.abort();
      held = false;
      const r = release;
      release = null;
      r?.();
      channel.onmessage = null;
      channel.close();
    },
    steal() {
      if (cancelled || held) return;
      queued?.abort();
      const gen = ++generation;
      // No signal and no ifAvailable: combining them with steal throws NotSupportedError.
      locks
        .request(name, { steal: true }, async () => {
          if (cancelled || gen !== generation) return;
          channel.postMessage({ type: 'home-base-taken', tabId });
          await hold(gen)();
        })
        .catch((error: unknown) => {
          if (!cancelled && held && gen === generation) lost();
          else if (!cancelled && !isAbort(error)) console.error('home base lock', (error as { name?: string }).name);
        });
    },
  };
}
