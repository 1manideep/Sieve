// Every string quoted in docs/spec/70-robustness.md, as named constants. Quoted copy is final: plain English, no em
// dashes, and no content from items. Placeholders are function parameters; callers pass already-cleaned values.
import type { Category, SourceKind } from '@sieve/shared';

const NOTHING_SENT = 'Nothing was sent.';

const SOURCE_NAMES: Readonly<Record<SourceKind, string>> = {
  gmail: 'your Gmail',
  folder: 'your folder',
  upload: 'files you added',
  playground: 'the sample data',
};

/** {source name} in the send-guard messages (70 section 3.3). */
export function sourceName(source: SourceKind | string): string {
  return (SOURCE_NAMES as Record<string, string>)[source] ?? 'that source';
}

/** 70 section 3.3: the re-check just before sending. */
export const SEND_GUARD = {
  textMismatch: `Sieve stopped: the text to send didn't match what you approved. ${NOTHING_SENT}`,
  empty: `There's nothing to send. ${NOTHING_SENT}`,
  tooLong: `This is more than Sieve sends at once (8,000 characters). ${NOTHING_SENT}`,
  notClean: `Sieve stopped: the text had characters it couldn't show you. ${NOTHING_SENT}`,
  missingItem: `That item is no longer on this device. ${NOTHING_SENT}`,
  ruleNever: (category: Category | string) => `Your rules now never share ${category} items. ${NOTHING_SENT}`,
  requestClosed: `This request was closed. ${NOTHING_SENT}`,
  expired: `This request expired. ${NOTHING_SENT}`,
  stepTooHigh: (aiName: string) => `${aiName} may no longer receive this much. ${NOTHING_SENT}`,
  categoryNotAllowed: (aiName: string, category: Category | string) => `${aiName} may no longer ask about ${category} items. ${NOTHING_SENT}`,
  sourceNotAllowed: (aiName: string, source: SourceKind | string) => `${aiName} may no longer use ${sourceName(source)}. ${NOTHING_SENT}`,
  blocked: (aiName: string) => `You blocked this item for ${aiName}. ${NOTHING_SENT}`,
  unmaskedNumber: (type: 'card' | 'iban' | 'ssn') =>
    `Sieve found a ${{ card: 'card number', iban: 'bank account number', ssn: 'social security number' }[type]} that wasn't masked, so it stopped. ${NOTHING_SENT}`,
  passedTrace: 'Checked your rules again just before sending',
  stoppedTrace: (message: string) => `Stopped just before sending: ${message.endsWith(NOTHING_SENT) ? message.slice(0, -NOTHING_SENT.length).trimEnd() : message}`,
} as const;

/** 70 section 4: questions typed into Sieve. */
export const QUESTION_COPY = {
  empty: 'Type a question first.',                                                                               // R-IN-01
  pasteCut: 'Sieve kept the first 500 characters of what you pasted. Questions work best short: who, what and roughly when.',   // R-IN-02
  hiddenRemoved: 'Sieve removed hidden characters from your question.',                                          // R-IN-03
  hiddenTextWarning: (tagText: string) => `This question contained hidden text: "${tagText}". Sieve removed it.`,  // R-IN-03 (at most 120 characters of tagText)
  hiddenTrace: (n: number) => `Removed ${n} hidden characters from the question`,                                // R-IN-03
  bidiWarning: 'This question contained text-direction controls. Sieve removed them.',                           // R-IN-04
  nonEnglishTrace: "Sieve's meaning search works best in English, so it also looked for exact words",           // R-IN-08
  spellingFixed: (corrected: string) => `Searched for "${corrected}" (spelling fixed on this device)`,           // R-IN-09
  ambiguousDate: (text: string, as: string) => `Read "${text}" as ${as}. It could mean another date; check the result.`,   // R-IN-11
  actionWarning: (verb: string) => `This asks Sieve to ${verb}. Sieve can't do that: it only finds things and shares what you approve.`,   // R-IN-18
  waitingForModel: 'Waiting for the on-device model: it is answering another request first.',                    // R-IN-20
} as const;

/** 70 section 5: questions from outside assistants. */
export const RELAY_QUESTION_COPY = {
  noReadableWords: 'The question had no readable words. Ask again in plain text.',                              // R-MCP-04, to the AI
  tooLongForServer: 'The question must be 1 to 500 characters of plain text.',                                   // R-MCP-05
  unknownRequest: 'Sieve has no request with that id for this connection. It may have expired; ask again.',      // R-MCP-07
  approveOnlyIfAsked: (aiName: string) => `Approve only if you asked ${aiName} for this. If you didn't, deny it and turn off this connection in Settings.`,   // R-MCP-09
  queued: 'Waiting: Sieve is preparing another request first.',                                                  // R-MCP-10
  asks: (aiName: string) => `${aiName} asks:`,                                                                   // R-UI-06
} as const;

/** 70 section 6: mail. */
export const MAIL_COPY = {
  unreadableCharsTrace: "Some characters in this email couldn't be read",                                       // R-MAIL-02
  noText: '(No text)',                                                                                           // R-MAIL-06
  tokenExpiredBanner: "Gmail sign-in expired. Sieve still answers from mail it already has, but can't add new mail or confirm an email is still in Gmail.",   // R-MAIL-10
  tokenExpiredButton: 'Continue syncing Gmail',                                                                  // R-MAIL-10
  forbidden: (reason: string) => `Gmail refused access: ${reason}.`,                                             // R-MAIL-11
} as const;

/** 70 section 8: index consistency. */
export const INDEX_COPY = {
  deletedEmailTrace: 'That email was deleted, so it was skipped',                                                // R-IDX-01
  staleEntriesTrace: (n: number) => `${n} stale search entries skipped`,                                         // R-IDX-01
  alsoIn: (folder: string) => `(also in ${folder})`,                                                             // R-IDX-04
  folderMeta: (date: string, folderPath: string) => `${date} · in ${folderPath}`,                               // R-IDX-05
  uploadMeta: (date: string, added: string) => `${date} · added ${added}`,                                       // R-IDX-05
  titleInFolder: (folder: string) => ` (in ${folder})`,                                                          // R-IDX-05 (panel title suffix)
  blockedForAi: (aiName: string) => `1 item you blocked for ${aiName}`,                                          // R-IDX-06
  checkingAfterInterruption: 'Checking the index after an interruption…',                                        // R-IDX-11
  deletedBeforeSend: 'That item was deleted, so nothing was sent.',                                              // R-IDX-13
  couldNotCheck: (kind: 'email' | 'file', reason: string, lastSeen: string) =>
    `Sieve couldn't check that this ${kind} is still there (${reason}). It was there on ${lastSeen}.`,            // R-IDX-14
  couldNotCheckReason: {
    'no-token': 'Gmail needs you to sign in again',
    offline: "you're offline",
    'gmail-error': "Gmail didn't answer",
    'no-permission': 'Sieve needs access to the folder again',
  },
  couldNotCheckTrace: (reason: string) => `Couldn't check the item is still there: ${reason}`,                   // R-IDX-14
  folderTooBig: "Sieve can't watch every file in a folder this big. Pick a smaller folder for the best results.",   // R-IDX-16
  shortenPathStart: (path: string, max = 60) => (path.length <= max ? path : `…${path.slice(path.length - (max - 1))}`),   // R-IDX-05 "cut at the start with …"
} as const;

/** 70 section 9: files and photos. */
export const FILE_COPY = {
  noTextFound: '(No text found)',                                                                                // R-FILE-01
  noTextToShare: 'This item has no text to share.',                                                              // R-FILE-01
  passwordSkipped: (n: number) => `${n} password-protected PDFs skipped.`,                                       // R-FILE-05
  noReadableText: (n: number) => `${n} PDFs have no readable text (often scans). Sieve finds them by name only.`,   // R-FILE-06
  allowAgain: (folderName: string) => `Allow access to ${folderName} again to keep it up to date`,               // R-FILE-11
  folderNotFound: 'Folder not found. Pick it again.',                                                            // R-FILE-12
  officeUnsupported: (n: number) => `${n} Word, Excel or other office files can't be read yet.`,                 // R-FILE-15
} as const;

/** 70 section 11: model and platform. */
export const PLATFORM_COPY = {
  modelRemoved: 'Chrome removed the on-device model, usually to free disk space (it keeps the model only while 10 GB are free). Free up space, then set it up again.',   // R-MDL-03
  modelRemovedAction: 'Set it up',                                                                               // R-MDL-03
  sessionClosed: 'The on-device session closed. Try again.',                                                     // R-MDL-05
  checkTheAnswer: (facts: string[]) =>
    `Check the answer: ${facts.join(', ')} ${facts.length === 1 ? 'is' : 'are'} not in the item. Share the exact lines if you're not sure.`,   // R-MDL-07
  keywordOnlyTrace: "Searched by keywords only: meaning search isn't working on this device right now",         // R-MDL-11
  waitingForClick: 'Waiting for you to click in this tab once',                                                  // R-MDL-12
  waitingHidden: 'Waiting for the Sieve tab: Chrome may slow the on-device model in background tabs.',           // R-PLAT-01
  discarded: 'Chrome put this tab to sleep to save memory, so AIs couldn\'t reach Sieve. To keep it awake, open Chrome Settings › Performance and add this site to "Always keep these sites active".',   // R-PLAT-02
  expiredToast: (aiName: string) => `The request from ${aiName} expired before you answered it.`,               // R-PLAT-04
  privateWindow: 'This looks like a private window. Sieve forgets its index here when you close the window, and the cloud model may refuse to run.',   // R-PLAT-06
  outOfSpace: 'This browser is almost out of space for Sieve. Free some disk space or disconnect a source.',      // R-PLAT-07
  indexEmpty: "Sieve's index on this computer is empty. If Chrome cleared it to free space, connect your sources again.",   // R-PLAT-08
  updatedInAnotherTab: 'Sieve was updated in another tab. Reload this tab.',                                     // R-PLAT-09
  closeOtherTabs: 'Close other Sieve tabs to finish updating.',                                                  // R-PLAT-09
  olderCopy: 'This tab has an older copy of Sieve. Reload to update.',                                           // R-PLAT-10
  reload: 'Reload',                                                                                              // R-PLAT-10
  cannotOpenIndex: "Sieve can't open its index on this computer. You can rebuild it: Sieve deletes the index here and reads your sources again. Your mail and files are not touched. You'll need to pick your folder again.",   // R-PLAT-10
  rebuildIndex: 'Rebuild the index',                                                                             // R-PLAT-10
  updated: 'Sieve was updated',                                                                                  // R-PLAT-11
  cloudUnreachable: "Couldn't reach the cloud model. Check your connection.",                                    // R-PLAT-12
  homeBaseReconnecting: 'Home base reconnecting',                                                                // R-PLAT-13
  homeBaseStopped: 'Home base stopped: sign out and in again',                                                   // R-PLAT-13
  signOut: 'Sign out',                                                                                           // R-PLAT-13
  clockSkew: (amount: number, unit: 'minutes' | 'hours', direction: 'ahead' | 'behind') =>
    `Your computer's clock is ${amount} ${unit} ${direction}. Sieve uses Google's time for requests, but dates like "yesterday" may be read wrong until you fix the clock.`,   // R-PLAT-14
  appCheck: "Google couldn't verify this browser, so Sieve's cloud features are off here for now. If you use an ad blocker or a private window, allow google.com/recaptcha for this site or use a normal window, then reload.",   // R-PLAT-15
  cloudBusy: 'The cloud model is busy right now. Try again in a minute, or use Chrome with Gemini Nano to run it on this device.',   // R-PLAT-16
} as const;

/** 70 section 12: relay and approval. */
export const RELAY_COPY = {
  revokedToast: (aiName: string) => `${aiName}'s connection was revoked, so its request was cancelled.`,         // R-RLY-08
  mayOnlyReceive: (aiName: string, step: 'answer' | 'excerpt') => `${aiName} may only receive ${step === 'answer' ? 'the answer' : 'an excerpt'}.`,   // R-RLY-09
  unreadableRequest: "Sieve couldn't read this request. Ask again.",                                             // R-RLY-11
  sendFailed: "Couldn't send. Check your connection and try again.",                                             // R-RLY-13
  alreadyDelivered: 'That answer was already delivered. Sieve shares each answer only once; ask again if you need it.',   // R-RLY-14
  receiptExpired: 'Expired',                                                                                     // R-RLY-07
  nothingLeft: 'Nothing left this device',                                                                       // R-RLY-07
} as const;

/** 70 section 13: output. */
export const OUTPUT_COPY = {
  blockedToAi: "The person's rules don't allow sharing this.",                                                  // R-OUT-09
  itemGone: 'Item no longer on this device',                                                                     // R-OUT-10
} as const;

/** Every final string (no placeholders), for the no-dash and no-content checks. */
export function allStaticCopy(): string[] {
  const out: string[] = [];
  const groups = [SEND_GUARD, QUESTION_COPY, RELAY_QUESTION_COPY, MAIL_COPY, INDEX_COPY, FILE_COPY, PLATFORM_COPY, RELAY_COPY, OUTPUT_COPY];
  const visit = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) visit(x);
  };
  for (const g of groups) visit(g);
  return out;
}
