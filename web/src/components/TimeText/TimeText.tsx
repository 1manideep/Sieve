// TimeText (40 section 16.19): a <time dateTime> with one of four formats.
import { TIME_COPY, fill } from '@/copy/screens-main';

export type TimeFormat = 'time' | 'day-time' | 'date' | 'relative';

export interface TimeTextProps {
  at: number;
  format: TimeFormat;
  now?: number;
}

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dateYearFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const relativeFmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Mar 3, 2026" (always with the year). */
export function formatDate(at: number): string {
  return dateYearFmt.format(at);
}

/** "Today, 2:15 PM" / "Yesterday, 9:03 AM" / "Nov 12" (this year) / "Nov 12, 2025" (40 section 13.7). */
export function formatDayTime(at: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return fill(TIME_COPY.today, { time: timeFmt.format(at) });
  if (days === 1) return fill(TIME_COPY.yesterday, { time: timeFmt.format(at) });
  return new Date(at).getFullYear() === new Date(now).getFullYear() ? dateFmt.format(at) : dateYearFmt.format(at);
}

/** "2 months ago", "yesterday", "in 3 days" (Intl.RelativeTimeFormat, numeric auto). */
export function formatRelative(at: number, now: number = Date.now()): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return relativeFmt.format(Math.round(diff / minute), 'minute');
  if (abs < day) return relativeFmt.format(Math.round(diff / hour), 'hour');
  const days = Math.round((startOfDay(at) - startOfDay(now)) / day);
  if (Math.abs(days) < 30) return relativeFmt.format(days, 'day');
  if (Math.abs(days) < 365) return relativeFmt.format(Math.round(days / 30), 'month');
  return relativeFmt.format(Math.round(days / 365), 'year');
}

export function formatTime(at: number, format: TimeFormat, now: number = Date.now()): string {
  switch (format) {
    case 'time':
      return timeFmt.format(at);
    case 'day-time':
      return formatDayTime(at, now);
    case 'date':
      return formatDate(at);
    case 'relative':
      return formatRelative(at, now);
  }
}

export function TimeText({ at, format, now }: TimeTextProps) {
  return <time dateTime={new Date(at).toISOString()}>{formatTime(at, format, now)}</time>;
}
