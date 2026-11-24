// How far back Gmail is read (Nov 24, 2026): the stored choice and its choices, with no index code, so the Sources and
// Setup screens can show it before the index loads. sources/gmail/window.ts applies it.

export const GMAIL_WINDOW_KEY = 'sieve.gmailWindowDays';
/** The choices offered, in days. 180 is the default's length, picked explicitly (then strict). */
export const GMAIL_WINDOW_CHOICES = [7, 14, 30, 90, 180, 365] as const;
export const GMAIL_WINDOW_MAX_DAYS = 3650;

export function isGmailWindowDays(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= GMAIL_WINDOW_MAX_DAYS;
}

/** The window this computer uses, in days, or undefined for the default (six months, not strict). */
export function readGmailWindowDays(): number | undefined {
  try {
    const raw = window.localStorage.getItem(GMAIL_WINDOW_KEY);
    const n = raw === null ? NaN : Number(raw);
    return isGmailWindowDays(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

export function writeGmailWindowDays(days: number | undefined): void {
  try {
    if (days === undefined) window.localStorage.removeItem(GMAIL_WINDOW_KEY);
    else window.localStorage.setItem(GMAIL_WINDOW_KEY, String(days));
  } catch {
    /* storage refused (private mode): the choice lasts for this page only */
  }
}
