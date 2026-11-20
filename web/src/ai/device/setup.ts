// First-run setup of Gemini Nano (10 section 7.3). 40's /prepare screen calls downloadNano() as the first statement of
// a click handler: Chrome starts a download only with user activation.
import { IMAGE_CREATE_OPTIONS, TEXT_CREATE_OPTIONS } from '../config';
import { isE2E, setE2ENano } from '../e2e';
import { getNanoAvailability, setSetupFraction } from './availability';
import { getLanguageModel } from './languageModel';
import { FOREGROUND_FIRST, warmBaseSessions } from './sessions';

export type NanoSetupCode = 'needs-click' | 'no-api' | 'unavailable' | 'no-space' | 'failed';

export const NANO_SETUP_MESSAGES: Record<NanoSetupCode, string> = {
  'needs-click': 'Click the button again to start setting up the on-device model.',
  'no-api': "This browser can't run Gemini Nano. Use Chrome on a desktop computer.",
  unavailable: "This Chrome or this computer can't run Gemini Nano.",
  'no-space': 'Chrome needs about 22 GB of free disk space to set up Gemini Nano.',
  failed: "Setting up the on-device model didn't finish. Check your connection and try again.",
};

export class NanoSetupError extends Error {
  constructor(
    readonly code: NanoSetupCode,
    message: string,
  ) {
    super(message);
    this.name = 'NanoSetupError';
  }
}

function setupError(code: NanoSetupCode): NanoSetupError {
  return new NanoSetupError(code, NANO_SETUP_MESSAGES[code]);
}

function mapSetupError(e: unknown): NanoSetupError {
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === 'NotAllowedError') return setupError('needs-click');
  if (name === 'NotSupportedError') return setupError('unavailable');
  if (name === 'QuotaExceededError') return setupError('no-space');
  return setupError('failed');
}

let running: { promise: Promise<void>; listeners: Set<(f: number) => void> } | null = null;

function simulateE2EDownload(listeners: Set<(f: number) => void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const steps = [0.25, 0.5, 1];
    let i = 0;
    const tick = () => {
      const f = steps[i];
      setSetupFraction(f);
      for (const l of [...listeners]) l(f);
      i += 1;
      if (i < steps.length) {
        setTimeout(tick, 100);
        return;
      }
      setE2ENano('available');
      setSetupFraction(null);
      void getNanoAvailability({ maxAgeMs: 0 }).then(() => resolve());
    };
    setTimeout(tick, 100);
  });
}

export function downloadNano(opts?: { onProgress?: (fraction: number) => void; image?: boolean }): Promise<void> {
  // Synchronous until create() is called, so the click's user activation is still active.
  if (running) {
    if (opts?.onProgress) running.listeners.add(opts.onProgress);
    return running.promise;
  }
  const listeners = new Set<(f: number) => void>();
  if (opts?.onProgress) listeners.add(opts.onProgress);

  if (isE2E()) {
    const promise = simulateE2EDownload(listeners).finally(() => {
      running = null;
    });
    running = { promise, listeners };
    return promise;
  }

  const LM = getLanguageModel();
  if (!LM) return Promise.reject(setupError('no-api'));
  const activation = (navigator as { userActivation?: { isActive: boolean } }).userActivation;
  if (activation && !activation.isActive) return Promise.reject(setupError('needs-click'));

  let last: number | null = null;
  const report = (loaded: number) => {
    const f = Math.min(1, Math.max(0, Number.isFinite(loaded) ? loaded : 0));
    if (last !== null && Math.abs(f - last) < 0.005) return;
    last = f;
    setSetupFraction(f);
    for (const l of [...listeners]) {
      try {
        l(f);
      } catch (e) {
        console.error('A setup progress listener failed.', e);
      }
    }
  };

  let created: ReturnType<typeof LM.create>;
  try {
    created = LM.create({
      ...(opts?.image ? IMAGE_CREATE_OPTIONS : TEXT_CREATE_OPTIONS),
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => report(e.loaded));
      },
    });
  } catch (e) {
    created = Promise.reject(e);
  }

  const promise = created.then(
    async (session) => {
      session.destroy();
      setSetupFraction(null);
      await getNanoAvailability({ maxAgeMs: 0 });
      void warmBaseSessions(FOREGROUND_FIRST);
    },
    async (e: unknown) => {
      setSetupFraction(null);
      await getNanoAvailability({ maxAgeMs: 0 }).catch(() => undefined);
      throw mapSetupError(e);
    },
  );
  const tracked = promise.finally(() => {
    running = null;
  });
  running = { promise: tracked, listeners };
  return tracked;
}
