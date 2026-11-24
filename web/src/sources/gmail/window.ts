// How far back Gmail is read (Nov 24, 2026). By default Sieve indexes the last six months and a question may still
// fetch an older email it needs (liveSearch.ts). A person who picks a window, say the last 30 days, gets a strict
// limit instead: indexing lists only that window, a question never reaches past it, and email older than its start
// leaves the index, now and on every reconciliation, so the window keeps its length as days pass.
//
// The choice belongs to this computer, like the index itself, so it is kept in this browser and never in Firestore.
import type { SieveDb } from '../../index/db';
import { GMAIL_BACKFILL_QUERY } from '../../index/config';
import { removeRecords } from '../../index/consistency';
import { GMAIL_WINDOW_CHOICES, GMAIL_WINDOW_MAX_DAYS, isGmailWindowDays, readGmailWindowDays, writeGmailWindowDays } from '../../state/gmailWindow';

export { GMAIL_WINDOW_CHOICES, readGmailWindowDays };

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 183;   // newer_than:6m
const EXCLUDE = '-in:chats -in:drafts';

/** The Gmail query that lists what indexing reads: Gmail's own newer_than, counted in days. */
export function gmailWindowQuery(days: number | undefined): string {
  return days === undefined ? GMAIL_BACKFILL_QUERY : `newer_than:${days}d ${EXCLUDE}`;
}

/** The first moment the window holds (ms), or undefined when no window is set. */
export function gmailWindowStart(days: number | undefined, now = Date.now()): number | undefined {
  return days === undefined ? undefined : now - days * DAY_MS;
}

/** The window's first day as YYYY-MM-DD in local time, for a live search's after: date. */
export function gmailWindowFirstDay(days: number | undefined, now = Date.now()): string | undefined {
  const start = gmailWindowStart(days, now);
  if (start === undefined) return undefined;
  const d = new Date(start);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Removes indexed email older than the window's start. Returns how many left; 0 when no window is set. */
export async function trimToGmailWindow(db: SieveDb, days: number | undefined, now = Date.now()): Promise<number> {
  const start = gmailWindowStart(days, now);
  if (start === undefined) return 0;
  const old = (await db.records.where('date').below(start).filter((r) => r.source === 'gmail').primaryKeys()) as string[];
  return old.length > 0 ? removeRecords(db, old, 'user-removed') : 0;
}

/**
 * Saves a new window and applies it: older email leaves the index at once, and a longer window lists again so the
 * days it adds are read. `resync` runs Gmail's backfill when Gmail is connected; the caller passes runGmailSync.
 */
export async function setGmailWindow(
  db: SieveDb,
  days: number | undefined,
  resync: (db: SieveDb) => Promise<void>,
): Promise<{ removed: number }> {
  if (days !== undefined && !isGmailWindowDays(days)) throw new RangeError(`gmail window must be 1..${GMAIL_WINDOW_MAX_DAYS} days`);
  const before = readGmailWindowDays();
  writeGmailWindowDays(days);
  const removed = await trimToGmailWindow(db, days);
  const row = await db.sources.get('gmail');
  // the default is six months long; only a longer window has days that were never listed
  const length = (d: number | undefined) => d ?? DEFAULT_DAYS;
  const longer = length(days) > length(before);
  if (row?.connected && longer) void resync(db).catch(console.error);
  return { removed };
}
