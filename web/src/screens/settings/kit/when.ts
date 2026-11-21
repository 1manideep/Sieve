// Date and time text for the control screens. Formats from 40 section 13.7 ("Today, 2:15 PM", "Yesterday, 9:03 AM",
// "Nov 12" this year, "Nov 12, 2025") and relative times through Intl.RelativeTimeFormat (13.6, 13.8.1).
import { SEEN, fillText } from '@/copy/screens-controls';

const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dayMonthYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const ICU_SPACES = new RegExp('[' + String.fromCharCode(0x202f, 0x00a0) + ']', 'g');

/** ICU puts a narrow no-break space before AM and PM; the copy uses a plain space. */
function plain(text: string): string {
  return text.replace(ICU_SPACES, ' ');
}

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "2:14 PM" */
export function formatClock(at: number): string {
  return plain(clock.format(at));
}

/** "Nov 12" in the current year, else "Nov 12, 2025". */
export function formatDate(at: number, now: number = Date.now()): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return plain((sameYear ? dayMonth : dayMonthYear).format(at));
}

/** "Today, 2:15 PM", "Yesterday, 9:03 AM", else formatDate. */
export function formatDayTime(at: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  const day = startOfDay(at);
  if (day === today) return fillText(SEEN.today, { time: formatClock(at) });
  if (day === startOfDay(today - 12 * 3_600_000)) return fillText(SEEN.yesterday, { time: formatClock(at) });
  return formatDate(at, now);
}

/** The local day a moment falls on (its midnight), for grouping rows by day. */
export function dayOf(at: number): number {
  return startOfDay(at);
}

/** "Today · Friday, Nov 20", "Yesterday · Thursday, Nov 19", else "Wednesday, Nov 18". */
export function formatDayHeading(at: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  const day = startOfDay(at);
  const date = plain(weekday.format(at));
  if (day === today) return fillText(SEEN.dayToday, { date });
  if (day === startOfDay(today - 12 * 3_600_000)) return fillText(SEEN.dayYesterday, { date });
  return date;
}

/** "now", "5 minutes ago", "yesterday", "in 3 days". */
export function formatRelative(at: number, now: number = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return relative.format(0, 'second');
  if (abs < 45 * 60) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 22 * 3600) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 26 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day');
  if (abs < 320 * 86_400) return relative.format(Math.round(seconds / (30 * 86_400)), 'month');
  return relative.format(Math.round(seconds / (365 * 86_400)), 'year');
}

export function isoTime(at: number): string {
  return new Date(at).toISOString();
}
