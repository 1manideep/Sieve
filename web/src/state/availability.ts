// useAvailability (40 section 9.3): on-device model availability for the status strip and setup.
// The AI layer is loaded with a dynamic import so it stays out of the /welcome bundle (40 section 17.1).
import { create } from 'zustand';
import type { NanoAvailability } from '@sieve/shared';
import { MODEL_SETUP_ERRORS } from '@/copy/strings';

type AiModule = typeof import('@/ai');

export type SetupState = 'idle' | 'downloading' | 'installing' | 'done' | 'error';
export interface AvailabilityState {
  text: NanoAvailability | 'checking';
  image: NanoAvailability | 'checking';
  checkedAt?: number;
  setup: { state: SetupState; fraction?: number; startedAt?: number; error?: string };
  refresh(): Promise<void>;                 // getNanoAvailability()
  start(): () => void;                      // refresh now; poll every 60 s, every 3 s while text is 'downloading'; refresh on window focus
  startSetup(): void;                       // MUST be called synchronously inside a click handler (13.2)
}

export const POLL_MS = 60_000;
export const POLL_DOWNLOADING_MS = 3_000;

let aiModule: Promise<AiModule> | undefined;
let aiLoaded: AiModule | undefined;
let loggedFailure = false;

/** Loads the AI layer once. */
export function loadAi(): Promise<AiModule> {
  aiModule ??= import('@/ai').then((m) => {
    aiLoaded = m;
    return m;
  });
  return aiModule;
}

/** The 13.2 message for a setup rejection (DOMException names, or the AI layer's NanoSetupError codes). */
export function setupErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (name === 'QuotaExceededError' || code === 'no-space' || /disk|space|quota/i.test(message)) return MODEL_SETUP_ERRORS.noSpace;
  if (name === 'NotAllowedError' || code === 'needs-click') return MODEL_SETUP_ERRORS.needsClick;
  if (name === 'NetworkError' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return MODEL_SETUP_ERRORS.network;
  return MODEL_SETUP_ERRORS.other;
}

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 0);
  return () => window.clearTimeout(handle);
}

export const useAvailability = create<AvailabilityState>()((set, get) => ({
  text: 'checking',
  image: 'checking',
  checkedAt: undefined,
  setup: { state: 'idle' },

  async refresh() {
    try {
      const ai = await loadAi();
      const { text, image } = await ai.getNanoAvailability();
      set({ text, image, checkedAt: Date.now() });
    } catch (error) {
      set({ text: 'unavailable', image: 'unavailable', checkedAt: Date.now() });
      if (!loggedFailure) {
        loggedFailure = true;
        console.error('Could not check the on-device model.', error);
      }
    }
  },

  start() {
    let stopped = false;
    let timer: number | undefined;
    const schedule = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, get().text === 'downloading' ? POLL_DOWNLOADING_MS : POLL_MS);
    };
    const tick = () => {
      void get().refresh().finally(schedule);
    };
    const onFocus = () => {
      void get().refresh().finally(schedule);
    };
    const cancelIdle = whenIdle(tick);
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      cancelIdle();
      window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  },

  startSetup() {
    const onProgress = (fraction: number) => {
      const f = Math.max(0, Math.min(1, fraction));
      set((s) => ({ setup: { ...s.setup, state: f >= 1 ? 'installing' : 'downloading', fraction: f } }));
    };
    const run = (ai: AiModule) => ai.downloadNano({ onProgress });
    // Chrome allows the download only on or after a user interaction, so the call is the first statement when the
    // AI layer is already loaded (it is, after boot): no await before it.
    let started: Promise<void>;
    try {
      started = aiLoaded ? run(aiLoaded) : loadAi().then(run);
    } catch (error) {
      started = Promise.reject(error);
    }
    if (get().setup.state !== 'downloading' && get().setup.state !== 'installing') {
      set({ setup: { state: 'downloading', fraction: 0, startedAt: Date.now() } });
    }
    started.then(
      () => {
        set((s) => ({ setup: { ...s.setup, state: 'done', fraction: 1, error: undefined } }));
        void get().refresh();
      },
      (error: unknown) => {
        set((s) => ({ setup: { ...s.setup, state: 'error', error: setupErrorMessage(error) } }));
        void get().refresh();
      },
    );
  },
}));

/** Test seam: forget the loaded module and the logged failure. */
export function resetAvailabilityForTests(): void {
  aiModule = undefined;
  aiLoaded = undefined;
  loggedFailure = false;
  useAvailability.setState({ text: 'checking', image: 'checking', checkedAt: undefined, setup: { state: 'idle' } });
}
