// The original found for a request that asked for the file itself, kept in memory between the moment the card is
// shown and the person's decision (original.ts finds it, the home base uploads it only after an approval). It is
// never written anywhere: closing the tab forgets it, and the request is prepared again.
const stash = new Map<string, Blob>();

export function stashFile(requestId: string, blob: Blob): void {
  stash.set(requestId, blob);
}

/** The stashed file, which stays until the request ends (a failed upload can be tried again). */
export function stashedFile(requestId: string): Blob | undefined {
  return stash.get(requestId);
}

export function dropFile(requestId: string): void {
  stash.delete(requestId);
}

/** Tests. */
export function clearFileStash(): void {
  stash.clear();
}
