// Keyboard rules shared by Segmented, LadderControl and ModelToggle (40 section 14.2): arrow keys move and select,
// skipping unavailable options; Home and End go to the first and last available option; Tab leaves the group.

/** The index the key moves to, or null when the key is not a group key or nothing is available. */
export function nextRadioIndex(current: number, key: string, enabled: readonly boolean[]): number | null {
  const n = enabled.length;
  if (n === 0 || !enabled.some(Boolean)) return null;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (key === 'Home') return enabled.indexOf(true);
  if (key === 'End') return enabled.lastIndexOf(true);
  if (step === 0) return null;
  let i = current;
  for (let tries = 0; tries < n; tries += 1) {
    i = (i + step + n) % n;
    if (enabled[i]) return i;
  }
  return null;
}

/** Which option holds tabIndex 0: the selected one when it is available, else the first available one. */
export function tabStopIndex(selected: number, enabled: readonly boolean[]): number {
  if (selected >= 0 && enabled[selected]) return selected;
  const first = enabled.indexOf(true);
  return first === -1 ? Math.max(0, selected) : first;
}
