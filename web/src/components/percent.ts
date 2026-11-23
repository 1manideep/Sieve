// Whole percents for the screen, worked out one way everywhere. A rounded number must not say more than is true:
// "100%" only when nothing is left, and "0%" only when nothing is done. Before, an unfinished source could read
// "indexing 100%" (99.6 rounded up), and the ring in the rail was counted only when the route changed.

/** `part` of `whole` as a whole percent: 100 only when part is all of it, at least 1 once part is above zero. */
export function wholePercent(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  if (part >= whole) return 100;
  return Math.min(99, Math.max(1, Math.floor((part / whole) * 100)));
}

/** A fraction (0..1) of work that is not finished yet, as a whole percent: never 100. */
export function unfinishedPercent(fraction: number): number {
  if (!(fraction > 0)) return 0;
  return Math.min(99, Math.floor(Math.min(1, fraction) * 100));
}
