// One console line for a failure that would otherwise leave no trace in production: the error's name and the start
// of its message. Callers put a fixed prefix in front and never log the question, hints, titles or item content.
// Pure: no DOM, no network, no storage.

/** How much of an error's message is logged. */
export const ERROR_MESSAGE_CHARS = 160;

/**
 * "TypeError: Failed to fetch dynamically imported module: /assets/x.js". A SyntaxError gives its name only: a parser's
 * message quotes the text it read, which may be an item's. A thrown value that is not an error gives its type only.
 */
/** The error's name alone, as letters and digits ("TypeError", "QuotaExceededError"), for a short reason code. */
export function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  const clean = typeof name === 'string' ? name.replace(/[^A-Za-z0-9]/g, '').slice(0, 30) : '';
  return clean || typeof error;
}

export function errorLine(error: unknown): string {
  const e = error as { name?: unknown; message?: unknown } | null;
  const name = typeof e?.name === 'string' && e.name ? e.name : typeof error;
  if (name === 'SyntaxError' || typeof e?.message !== 'string' || !e.message) return name;
  return `${name}: ${e.message.slice(0, ERROR_MESSAGE_CHARS)}`;
}
