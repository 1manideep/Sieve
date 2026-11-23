// "Today", "tomorrow", "yesterday" and "tonight" in an answer mean the day the item was written, not the day the
// question is asked: an event email of three weeks ago that says "today" was answered with "today" (Nov 22, 2026).
// When the item is not from today, plain code writes the date in place of the word. Nothing else is reworded.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_AHEAD = /^,?\s+(?:on\s+)?(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/;
const WORDS = /\b(today|tomorrow|yesterday|tonight)(['’]s)?(?![\p{L}\p{N}_-])/giu;
const SHIFT: Record<string, number> = { today: 0, tonight: 0, tomorrow: 1, yesterday: -1 };

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const written = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

/**
 * The answer with each of those words given its date, counted from the day the item is dated. Unchanged when the item
 * is from today, when it has no date, or when no such word is in it.
 * - "is today from 10:30 AM" becomes "is on November 6, 2026 from 10:30 AM"
 * - "begin tomorrow, November 5th" keeps its own date and loses the word: "begin November 5th"
 * - "today's event" becomes "the November 6, 2026 event"
 */
export function anchorRelativeDays(answer: string, itemDate: number | undefined, now: number): string {
  if (!itemDate || !Number.isFinite(itemDate)) return answer;
  const base = new Date(itemDate);
  if (sameDay(base, new Date(now))) return answer;
  return answer.replace(WORDS, (match: string, word: string, possessive: string | undefined, at: number) => {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (SHIFT[word.toLowerCase()] ?? 0));
    const rest = answer.slice(at + match.length);
    if (possessive) return `${at === 0 ? 'The' : 'the'} ${written(day)}`;
    if (MONTH_AHEAD.test(rest)) return '\uE000';   // its own date follows: the word and its comma go (cleaned below)
    const lower = word.toLowerCase();
    if (lower === 'tonight') return `${at === 0 ? 'On' : 'on'} the evening of ${written(day)}`;
    // at the start of the sentence the date stands as its subject ("November 6, 2026 is the last day")
    return at === 0 ? written(day) : `on ${written(day)}`;
  }).replace(/\s*\uE000,?\s*/g, ' ').replace(/\s+([.,;!?])/g, '$1').replace(/ {2,}/g, ' ').trim();
}
