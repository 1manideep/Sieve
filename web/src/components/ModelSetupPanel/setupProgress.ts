// Setup helpers for ModelSetupPanel (40 section 13.2): the error mapping, the ETA from observed progress, and which
// state the panel shows.
import type { NanoAvailability } from '@sieve/shared';
import type { SetupState } from '@/state/availability';
import { MODEL_SETUP_COPY } from '@/copy/screens-main';

/** Maps a setup rejection to the copy of 40 section 13.2 (also understands 10's NanoSetupError codes). */
export function setupErrorMessage(error: unknown, online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine): string {
  const e = (error ?? {}) as { name?: unknown; message?: unknown; code?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  if (name === 'QuotaExceededError' || code === 'no-space' || /disk|space/i.test(message)) return MODEL_SETUP_COPY.errorDisk;
  if (name === 'NotAllowedError' || code === 'needs-click') return MODEL_SETUP_COPY.errorNotAllowed;
  if (name === 'NetworkError' || !online) return MODEL_SETUP_COPY.errorNetwork;
  return MODEL_SETUP_COPY.errorOther;
}

export interface ProgressSample { at: number; fraction: number }

export const ETA_MIN_SPAN_MS = 10_000;
export const ETA_WINDOW_MS = 120_000;

/** Remaining time from the samples of the last 120 s, once they span at least 10 s (like 40 section 9.12). */
export function setupEtaMs(samples: ProgressSample[], now: number): number | undefined {
  const recent = samples.filter((s) => now - s.at <= ETA_WINDOW_MS);
  if (recent.length < 2) return undefined;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = last.at - first.at;
  if (span < ETA_MIN_SPAN_MS) return undefined;
  const rate = (last.fraction - first.fraction) / span;
  if (rate <= 0) return undefined;
  return Math.max(0, (1 - last.fraction) / rate);
}

export type PanelState =
  | 'checking' | 'idle' | 'downloading' | 'installing' | 'ready' | 'elsewhere' | 'error' | 'unavailable';

/** Which state the panel shows for the store's availability and setup values. */
export function panelState(text: NanoAvailability | 'checking', setup: SetupState): PanelState {
  if (setup === 'error') return 'error';
  if (setup === 'downloading') return 'downloading';
  if (setup === 'installing') return 'installing';
  if (setup === 'done' || text === 'available') return 'ready';
  if (text === 'checking') return 'checking';
  if (text === 'downloading') return 'elsewhere';
  if (text === 'downloadable') return 'idle';
  return 'unavailable';
}

export function percent(fraction: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round((fraction ?? 0) * 100)));
}
