// Google's time, and skew detection (70 section 3.4, R-PLAT-14, R-RLY-02).
// The offset comes from the Realtime Database's `.info/serverTimeOffset`. The RTDB docs say it is affected by network
// latency, so serverNow() only applies it for a skew of a minute or more; clockSkewMs() reports the raw measurement.
import { onValue, ref, type Database } from 'firebase/database';

/** Below this the offset is treated as latency, not a wrong clock. */
export const TRUSTED_SKEW_MS = 60_000;
/** R-PLAT-14: the banner shows above this skew. */
export const SKEW_BANNER_MS = 300_000;

let offsetMs: number | null = null;   // server minus device, as RTDB reports it
const subscribers = new Set<(ms: number | null) => void>();

function emit(): void {
  const skew = clockSkewMs();
  for (const fn of [...subscribers]) {
    try {
      fn(skew);
    } catch (error) {
      console.error('clock subscriber', (error as { name?: string })?.name ?? 'error');
    }
  }
}

/** Records a new offset (server time minus device time, in ms). Exported for the RTDB handler and tests. */
export function setServerOffset(ms: number | null): void {
  const next = typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  if (next === offsetMs) return;
  offsetMs = next;
  emit();
}

/** Starts listening to `.info/serverTimeOffset` on the RTDB instance presence already uses. Returns a stop. */
export function startServerClock(rtdb: Database): () => void {
  return onValue(
    ref(rtdb, '.info/serverTimeOffset'),
    (snap) => setServerOffset(typeof snap.val() === 'number' ? (snap.val() as number) : null),
    (error) => console.error('server clock', (error as { code?: string })?.code ?? 'error'),
  );
}

/** Date.now() plus the offset when the skew is at least a minute; Date.now() until the offset is known. */
export function serverNow(): number {
  const now = Date.now();
  if (offsetMs === null || Math.abs(offsetMs) < TRUSTED_SKEW_MS) return now;
  return now + offsetMs;
}

/** How far this computer's clock is ahead of Google's, in ms (negative: behind). Null until the first offset. */
export function clockSkewMs(): number | null {
  return offsetMs === null ? null : -offsetMs;
}

/** Called with the current skew now and on every change. Returns an unsubscribe. */
export function subscribeSkew(fn: (ms: number | null) => void): () => void {
  subscribers.add(fn);
  try {
    fn(clockSkewMs());
  } catch (error) {
    console.error('clock subscriber', (error as { name?: string })?.name ?? 'error');
  }
  return () => {
    subscribers.delete(fn);
  };
}

/** For the R-PLAT-14 banner: null when the skew is unknown or within SKEW_BANNER_MS. */
export function skewForBanner(skew: number | null = clockSkewMs()): { amount: number; unit: 'minutes' | 'hours'; direction: 'ahead' | 'behind' } | null {
  if (skew === null || Math.abs(skew) <= SKEW_BANNER_MS) return null;
  const minutes = Math.round(Math.abs(skew) / 60_000);
  const direction = skew > 0 ? 'ahead' : 'behind';
  if (minutes > 120) return { amount: Math.round(minutes / 60), unit: 'hours', direction };
  return { amount: minutes, unit: 'minutes', direction };
}

/** Test seam: forget the offset and every subscriber. */
export function resetServerClockForTests(): void {
  offsetMs = null;
  subscribers.clear();
}
