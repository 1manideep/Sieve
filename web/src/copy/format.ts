import { ETA } from './strings';

const countFormat = new Intl.NumberFormat('en-US');

/** "1,204" (40 section 8.1 uses en-US grouping). */
export function formatCount(n: number): string {
  return countFormat.format(n);
}

/** Shared ETA helper (40 section 8.2): under 60 s "less than a minute"; under 60 min "{m} min"; else "{h} h {m} min". */
export function formatEta(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return ETA.underMinute;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ETA.minutes(minutes);
  return ETA.hoursMinutes(Math.floor(minutes / 60), minutes % 60);
}
