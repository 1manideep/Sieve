// Sentences written into RelayRequest.message for the outside AI (40 section 11.6). Never content.
// Blocked and no-match share one sentence (00 decision D6): an outside AI must not tell "blocked" from "no match".
// The person still sees the real reason in the app.
export const MSG = {
  declined: 'The person declined to share this.',
  blocked: 'Nothing to share for that.',
  noMatch: 'Nothing to share for that.',
  unsupported: "Sieve answers from one item at a time at this level, so counts aren't available.",
  oneFact: 'Sieve shares one fact at a time at this level.',
  nameSender: "Sieve could not tell who that is from. Ask again with the sender's name.",
  modelUnavailable: "Sieve can't read the person's data on this device right now. Try again later.",
  error: "Sieve couldn't prepare an answer on the person's device. Try again later.",
  /** A "latest" question while Gmail cannot be asked: no answer from mail that may be out of date. Never content. */
  mailNotCurrent: "Sieve could not check Gmail for newer mail, so it did not answer. Ask the person to open Sieve and reconnect Gmail there (one click on the Gmail card), then ask again.",
  /**
   * A result line with the reason nothing was shared, as a short code with no content ("model-picked-none"). Only
   * while the person has auto-approve (testing mode) on for that connection: otherwise the line stays as it is, so
   * an outside assistant cannot tell a held item from one that was not found.
   */
  withReason: (line: string, code: string | undefined) => {
    const c = (code ?? '').replace(/[^A-Za-z0-9.-]/g, '').slice(0, 96);
    return c ? `${line} (${c})` : line;
  },
  /** Testing mode only: which candidate an approved answer came from, as a code with no content (the relay shows it). */
  picked: (code: string) => `picked ${code.replace(/[^A-Za-z0-9.-]/g, '').slice(0, 96)}`,
  /** The same line with which step failed, as a short code with no content ("model-timeout", "search-TypeError"). */
  errorWith: (code: string) => `Sieve couldn't prepare an answer on the person's device. Try again later. (${code.replace(/[^A-Za-z0-9-]/g, '').slice(0, 48) || 'unknown'})`,
  badRequest: "Sieve couldn't read this request. Ask again.",
  noReadableWords: 'The question had no readable words. Ask again in plain text.',   // 70 R-MCP-04
} as const;

/** The line for an unsupported result: the pipeline's own reason when it is one of the fixed lines, else the counts line. Never content. */
export function unsupportedLine(reason: string | undefined): string {
  return reason === MSG.oneFact || reason === MSG.nameSender ? reason : MSG.unsupported;
}

export type MessageKey = keyof typeof MSG;
