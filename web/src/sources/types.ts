// Source types (20 section 14.1).

export type SourcePhase = 'idle' | 'listing' | 'metadata' | 'bodies' | 'incremental' | 'reconciling' | 'scanning' | 'reading' | 'seeding' | 'rebuilding';
/** 'no-text' is 70 R-FILE-06 (PDFs whose text is unreadable, often scans). */
export type SkipReason = 'too-large' | 'unsupported' | 'heic' | 'password' | 'unreadable' | 'binary' | 'limit' | 'no-text';
export type SourceErrorCode = 'auth-needed' | 'scope-denied' | 'popup-blocked' | 'popup-closed' | 'gis-load-failed'
  | 'permission-needed' | 'folder-missing' | 'storage-full' | 'network' | 'gmail-forbidden' | 'quota' | 'unknown';

/** An error a source operation reports on its row, with the sentence shown on the Sources screen. */
export class SourceError extends Error {
  constructor(readonly code: SourceErrorCode, message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/** Copy for source rows (20 sections 14 to 17). Full sentences, no em dashes, no item content. */
export const SOURCE_COPY = {
  gisLoadFailed: "Sign in to Sieve with Google first, then connect Gmail.",
  scopeDenied: 'Sieve needs read-only access to Gmail. Nothing was connected.',
  popupBlocked: 'Chrome blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  popupClosed: 'Sign-in was closed. Nothing changed.',
  signInFailed: "Google sign-in didn't finish. Try again.",
  otherAccount: 'Pick the Google account you use for Sieve, then try again.',
  noClientId: "Gmail sign-in isn't set up on this site yet.",
  gmailNeedsAuth: 'Syncing paused. Continue to keep getting new mail.',
  /** Google refused read-only Gmail access after Continue (a fresh token still got a 401, or the box was unticked). */
  gmailAccessRefused: "Google didn't allow read-only Gmail access. Try Continue again.",
  gmailForbidden: (reason: string) => `Gmail refused access: ${reason}.`,
  gmailQuota: 'Gmail is limiting requests. Sieve will try again in a few minutes.',
  network: "Couldn't reach Gmail. Sieve will try again when you're online.",
  noFolder: "No folder connected. If you picked a system folder, Chrome doesn't allow it. Pick a folder inside it.",
  noFolderApi: "This browser can't open folders. Use Chrome on a computer.",
  folderPermission: (name: string) => `Allow access to ${name} again to keep it up to date`,
  folderPickAgain: 'Sieve lost access to the folder. Pick it again.',
  folderMissing: 'Folder not found. Pick it again.',
  folderTooBig: "Sieve can't watch every file in a folder this big. Pick a smaller folder for the best results.",
  folderLimit: 'Sieve indexes the first 5,000 files in a folder.',
  storageFull: 'This browser is almost out of space for Sieve. Free some disk space or disconnect a source.',
  droppedFolders: 'Drop files, not folders. To index a folder, connect it in Sources.',
} as const;
