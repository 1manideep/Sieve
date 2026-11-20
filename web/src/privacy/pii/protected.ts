// Protected values (11 section 5.7): money, dates, times, percentages, years and short numbers are never personal
// details; they are often the answer. Applies to model and Nano spans.

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const PROTECTED: readonly RegExp[] = [
  /^\(?\s*(?:[$€£¥₹]|USD|EUR|GBP|INR|CAD|AUD)\s?[\d.,]+(?:\s?(?:k|m|bn))?\s*\)?$/i,
  /^[\d.,]+\s?(?:USD|EUR|GBP|dollars|euros|pounds)$/i,
  /^\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,4})?$/,
  new RegExp(`^${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?$`, 'i'),
  new RegExp(`^\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+\\d{4})?$`, 'i'),
  /^\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?$/i,
  /^\d+(?:\.\d+)?\s?%$/,
  /^(?:19|20)\d{2}$/,
  /^\d{1,4}$/,
];

export function isProtectedValue(s: string): boolean {
  const t = s.trim();
  return PROTECTED.some((re) => re.test(t));
}
