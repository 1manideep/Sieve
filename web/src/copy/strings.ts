// Every user-facing string in the web app (40 section 2: copy/strings.ts). Copy quoted in 40 is final.
// `{name}` values are filled by the functions below. No em dashes anywhere.

export const APP_NAME = 'Sieve';

/** Document titles (40 section 5.1). */
export const TITLES = {
  welcome: 'Sieve: give AI the answer, not your inbox',
  playground: 'Playground · Sieve',
  prepare: 'Prepare the on-device model · Sieve',
  setup: 'Set up · Sieve',
  ask: 'Ask · Sieve',
  requests: 'Requests · Sieve',
  sources: 'Sources · Sieve',
  seen: 'What has AI seen? · Sieve',
  settings: 'Settings · Sieve',
  notFound: 'Not found · Sieve',
  how: 'How it works · Sieve',
} as const;

/** "({n}) " before every title while requests wait (40 section 5.1). */
export function titleWithCount(title: string, waiting: number): string {
  return waiting > 0 ? `(${waiting}) ${title}` : title;
}

/** App shell (40 sections 4.1, 7 and 15.4). */
export const SHELL = {
  skipLink: 'Skip to main content',
  loading: 'Loading Sieve',
  narrowNotice: 'Sieve is made for a computer. Some screens may feel cramped here.',
  dismiss: 'Dismiss',
  offline:
    "You're offline. Sieve still searches this device. Requests from other AIs and drafting with the cloud model wait until you're back.",
  notifications: 'Notifications',
  working: 'Working',
  // 70 R-PLAT-09: another tab deleted or upgraded the index this tab had open (robust/copy.ts has the same words)
  updatedInAnotherTab: 'Sieve was updated in another tab. Reload this tab.',
  reload: 'Reload',
  deleteBlocked: 'Close other Sieve tabs, then try again.',
  deleteIndexBlocked: 'Close other Sieve tabs to finish deleting the index on this computer.',
} as const;

/** Main navigation (40 section 7.2). */
export const NAV = {
  label: 'Main',
  ask: 'Ask',
  requests: 'Requests',
  sources: 'Sources',
  seen: 'What has AI seen?',
  settings: 'Settings',
  requestsWaiting: (n: number) => `Requests, ${n} waiting`,
  // The left rail (docs/design/final-flow.md, F3 and F5)
  newAsk: 'New ask',
  tryComputer: 'Try on a real computer',
  control: 'Control',
  /** The ring at the bottom of the rail. */
  neverShared: (pct: number) => `${pct}% of your items never shared`,
  neverSharedTip: (never: string, total: string) => `Never shared · ${never} of ${total} items`,
} as const;

/** The Nano meter card at the bottom of the rail: short words next to "Gemini Nano", the index and the home base. */
export const RAIL = {
  nano: 'Gemini Nano',
  nanoReady: 'ready',
  nanoSettingUp: (pct: number) => `setting up ${pct}%`,
  nanoDownloading: 'setting up',
  nanoNotSetUp: 'not set up',
  nanoNone: 'not available',
  nanoChecking: 'checking',
  index: 'Index',
  indexing: (pct: number) => `indexing ${pct}%`,
  indexingYielding: 'paused for your question',
  indexingPaused: 'paused',
  homeBase: 'Home base',
  homeBaseOnline: 'online',
  homeBaseOff: 'off',
  homeBaseNeedsClick: 'needs a click',
  homeBaseStandby: 'another tab',
  homeBaseOther: 'another computer',
  homeBaseStarting: 'starting',
  offline: 'offline',
} as const;

/** The public header and footer (docs/design/final-flow.md, F1 and F2). */
export const PUBLIC_NAV = {
  label: 'Site',
  openSource: 'Open source',
  how: 'How it works',
  tryComputer: 'Try on a real computer',
  github: 'GitHub',
  openSieve: 'Open Sieve',
  menu: 'Menu',
  closeMenu: 'Close the menu',
  footer: 'Only what you approve leaves your computer.',
} as const;

/** Account menu (40 section 7.3). */
export const ACCOUNT = {
  button: 'Account',
  signedInAs: (email: string) => `Signed in as ${email}`,
  settings: 'Settings',
  signOut: 'Sign out',
} as const;

/** Sign-in errors (40 section 6.3). */
export const AUTH_ERRORS = {
  popupBlocked: 'Chrome blocked the sign-in window. Allow pop-ups for this site and try again.',
  network: "Couldn't reach Google. Check your connection and try again.",
  other: "Sign-in didn't work. Try again.",
} as const;

/** Route errors (40 section 7.8). */
export const ROUTE_ERROR = {
  notFoundTitle: "This page isn't here.",
  goToAsk: 'Go to Ask',
  openSieve: 'Open Sieve',
  notFoundLine: 'The address is wrong, or the page moved. Nothing was shared.',
  updatedTitle: 'Sieve was updated',
  updatedBody: 'Reload to get the new version.',
  reload: 'Reload',
  brokeTitle: 'Something broke on this screen',
  brokeBody: 'Nothing was shared. Reload to try again.',
} as const;

/** A tab still running the build from before a deploy (app/freshBuild.ts): one toast that stays until dismissed. */
export const FRESH_BUILD = {
  toast: 'Sieve was updated. Reload to keep it working.',
  reload: ROUTE_ERROR.reload,
} as const;

/** Status strip segments (40 section 8.1). */
export const STATUS = {
  offline: 'Offline',
  homeBaseStarting: 'Starting home base…',
  homeBaseOnline: 'Home base online',
  homeBaseNeedsClick: 'Home base needs a click',
  homeBaseOffline: 'Home base offline',
  homeBaseStandby: 'Home base in another tab',
  homeBaseOtherDevice: (label: string) => `Home base: ${label}`,
  otherDeviceFallback: 'another computer',      // used only if the home base device has no label yet
  noHomeBase: 'No home base',
  modelChecking: 'Checking on-device model…',
  modelReady: 'On-device model ready',
  modelPreparing: (pct: number) => `Preparing on-device model ${pct}%`,
  modelDownloading: 'On-device model downloading',
  modelNotSetUp: 'On-device model not set up',
  modelNone: 'No on-device model',
  indexingLeft: (left: string) => `Indexing ${left} left`,
  indexingYielding: 'Indexing paused for your question',
  indexingPaused: 'Indexing paused',
  autoApproveOn: 'Auto-approve on',             // 40 section 13.8.9, a link to Settings
  accessibleName: (segments: string[]) => `Status: ${segments.join(', ')}. Show details.`,
} as const;

/** Status popover (40 section 8.2). */
export const STATUS_POPOVER = {
  heading: 'Status',
  homeBase: 'Home base',
  model: 'On-device model',
  indexing: 'Indexing',
  extension: 'Sieve extension',
  homeBaseNone: 'Requests from AIs need an open Sieve tab on one computer.',
  homeBaseOnline: 'This tab handles requests from AIs. Keep it open.',
  homeBaseOffline: "This tab lost its connection. Requests wait until it's back.",
  homeBaseNeedsClick:
    'Chrome lets Sieve use the on-device model only after you click in this tab once. Click anywhere here and Sieve starts on the waiting request.',
  homeBaseStandby: 'Another Sieve tab on this computer is the home base.',
  homeBaseOtherDevice: (label: string) => `Requests go to ${label}.`,
  modelAvailable: 'Gemini Nano runs in this Chrome. Your data is read here.',
  modelDownloadable: 'Chrome sets up Gemini Nano once. It takes a few minutes.',
  modelSetupRunning: (pct: number) => `Setting up Gemini Nano: ${pct}%. You can keep using Sieve.`,
  modelDownloading: 'Chrome is setting up Gemini Nano. This can take a few minutes.',
  modelUnavailable:
    "This Chrome can't run Gemini Nano. Your own data stays unread here unless you turn on cloud fallback.",
  indexingRunning: (left: string, eta?: string) =>
    eta ? `Reading ${left} items on this device. About ${eta} left.` : `Reading ${left} items on this device.`,
  indexingYielding: 'Paused while Sieve answers your question. It picks up again on its own.',
  indexingPaused: 'Paused. Nothing new is indexed until you resume.',
  indexingProgress: 'Indexing progress',
  extensionConnected: 'Sieve extension connected. Approve requests from its side panel.',
  extensionNotInstalled: 'Approve requests next to any tab with the Sieve extension.',
  extensionReconnecting: 'Extension disconnected. Reconnecting…',
  extensionIdle: 'The extension talks to your home base tab.',
  makeHomeBase: 'Make this my home base',
  stopHomeBase: 'Stop being the home base',
  useThisTab: 'Use this tab instead',
  setItUp: 'Set it up',
  showProgress: 'Show progress',
  turnOnCloud: 'Turn on cloud fallback',
  pause: 'Pause',
  resume: 'Resume',
  getExtension: 'Get the extension',
  sourcesLink: 'Sources',
} as const;

/** formatEta (40 section 8.2). */
export const ETA = {
  underMinute: 'less than a minute',
  minutes: (m: number) => `${m} min`,
  hoursMinutes: (h: number, m: number) => `${h} h ${m} min`,
} as const;

/** Screen headings and leads (40 section 13). The full screens arrive with WP5. */
export const SCREENS = {
  welcome: {
    heading: 'Only what you approve leaves your computer.',
    lead: 'Sieve reads your mail, files and photos here, with Gemini Nano. An outside AI gets one line, after you say yes. A receipt every time.',
  },
  how: {
    heading: 'What happens to your data',
  },
  prepare: {
    heading: 'Prepare the on-device model',
    lead: 'Sieve reads your mail and files with Gemini Nano, a model that runs inside Chrome on this computer. Chrome downloads it once. It usually takes about 3 to 4 minutes, and then it works offline.',
  },
  setup: {
    heading: 'Set up Sieve',
  },
  ask: {
    heading: 'Ask your own data',
    lead: 'Searched on this device. Nothing leaves unless you choose what to share.',
  },
  requests: {
    heading: 'Requests',
    lead: 'When an AI you connected asks, the request waits here for you. You can also approve it in the Sieve extension.',
  },
  sources: {
    heading: 'Sources and your private index',
    lead: 'The index lives only on this device. Mail and files are read here, never on our server.',
  },
  seen: {
    heading: 'What has AI seen?',
    lead: 'A receipt for every share. Receipts never hold the contents, only what left, where to and when.',
  },
  settings: {
    heading: 'Settings',
    lead: 'Saved as you change them. Your settings sync; your data never does.',
  },
  playground: {
    heading: 'Playground',
    lead: 'A pretend computer in your browser. Add files, write test emails, ask anything. Nothing leaves it unless you approve.',
  },
  notFound: {
    heading: "This page isn't here.",
  },
} as const;

// ---------- Strings surfaced by the state, services and relay layer ----------

/** Status strip additions for the requests listener (70 section 3.6) and the error role (40 section 11.1). */
export const STATUS_LISTENER = {
  reconnecting: 'Home base reconnecting',
  stopped: 'Home base stopped: sign out and in again',
  errorTitle: (reason: string) => `The home base couldn't start. ${reason}`,
  tryAgain: 'Try again',
  signOut: 'Sign out',
} as const;

/** Settings writes (40 section 9.2). */
export const SETTINGS_SAVE = {
  failed: "Couldn't save that setting. Check your connection and try again.",
  saved: 'Saved',
  queued: "Saves when you're back online",
} as const;

/** Callable errors (40 section 10.5). */
export const CALLABLE_ERRORS = {
  unreachable: "Couldn't reach Sieve's server. Try again.",
  notAllowed: "You're not allowed to change this. Sign in again and retry.",
  precondition: "That change isn't possible right now.",
  other: 'Something went wrong on the server. Try again.',
} as const;

/** Model setup errors (40 section 13.2, mapped from the rejection). */
export const MODEL_SETUP_ERRORS = {
  noSpace: 'Chrome needs more free disk space (about 22 GB) to set up the model.',
  needsClick: 'Chrome needs a click to start. Press Try again.',
  network: 'The download stopped. Check your connection and press Try again.',
  other: "Chrome couldn't set up the model. Try again, or turn on cloud fallback in Settings.",
} as const;

/** The in-app golden path (40 section 12.3). */
export const ASK_FLOW = {
  emptyQuestion: 'Type a question first.',
  foundMatch: 'Found a match on this device. Review what would be shared.',
  neverShared: (category: string) => `${category} is never shared. Nothing left this device.`,
  noMatch: 'Nothing on this device matched.',
  unsupported: "Sieve answers from one item at a time, so counts aren't available.",
  needsConsent: 'This needs your OK before the cloud model can read it.',
  modelUnavailable: "The on-device model isn't available.",
  somethingWrong: 'Something went wrong on this device. Nothing was shared.',
  tooSlow: 'Sieve took too long on this device. Nothing was shared.',
  stopped: 'Stopped.',
  keptLocal: 'Kept on this device. Nothing was shared.',
  draftReady: 'Draft ready.',
  offlineDraft: "You're offline. Drafting needs the cloud model.",
  relatedFailed: "Couldn't prepare this item.",
  approveTrace: (stepLabel: string) => `You approved: ${stepLabel}`,
  mismatch: "Sieve stopped: the text to send didn't match what you approved. Nothing was sent.",
  receiptFailed: "Couldn't save the receipt, so nothing was sent. Try again.",
} as const;

/** draftReply errors (40 section 12.3 table). `aborted` is silent. */
export const DRAFT_ERRORS = {
  quota: 'The cloud model is busy right now. Try again in a minute.',
  appCheck: "The cloud model couldn't confirm this is the real Sieve app. Reload the page and try again.",
  timeout: 'The cloud model took too long. Try again.',
  tooLong: "That's too long for the cloud model. Pick a lower step.",
  badOutput: "The cloud model's reply didn't come through properly. Try again.",
  other: "The cloud model couldn't draft a reply. Try again.",
} as const;

/** Relay decisions (40 section 11.8). */
export const DECIDE_ERRORS = {
  notPending: "This request isn't waiting any more.",
  expired: 'This request expired. Nothing was sent.',
  invalidStep: "That step isn't allowed for this request.",
  tooLong: 'This is more than Sieve sends at once (8,000 characters). Untick an item or pick a lower step.',
  offline: "Couldn't send. Check your connection and try again.",
  mismatch: "Sieve stopped: the text to send didn't match what you approved. Nothing was sent.",
  noHomeBase: 'This tab is not handling requests right now.',
} as const;

/** The re-check just before sending (70 section 3.3). Every message ends with "Nothing was sent." */
export const SEND_CHECK = {
  textMismatch: "Sieve stopped: the text to send didn't match what you approved. Nothing was sent.",
  empty: "There's nothing to send. Nothing was sent.",
  tooLong: 'This is more than Sieve sends at once (8,000 characters). Nothing was sent.',
  missingItem: 'That item is no longer on this device. Nothing was sent.',
  ruleNever: (category: string) => `Your rules now never share ${category} items. Nothing was sent.`,
  requestClosed: 'This request was closed. Nothing was sent.',
  expired: 'This request expired. Nothing was sent.',
  stepTooHigh: (aiName: string) => `${aiName} may no longer receive this much. Nothing was sent.`,
  categoryNotAllowed: (aiName: string, category: string) => `${aiName} may no longer ask about ${category} items. Nothing was sent.`,
  sourceNotAllowed: (aiName: string, source: string) =>
    `${aiName} may no longer use ${({ gmail: 'your Gmail', folder: 'your folder', upload: 'files you added' } as Record<string, string>)[source] ?? 'that source'}. Nothing was sent.`,
  blocked: (aiName: string) => `You blocked this item for ${aiName}. Nothing was sent.`,
  passedTrace: 'Checked your rules again just before sending',
  stoppedTrace: (message: string) => `Stopped just before sending: ${message.replace(/ ?Nothing was sent\.$/, '')}`,
} as const;

/** The home base (40 sections 11.3 to 11.8, 70 R-PLAT-01, R-PLAT-02, R-RLY-09). */
export const HOME_BASE = {
  anotherTab: 'Another tab is the home base now.',
  errorNoLocks: "This browser doesn't support Web Locks.",
  errorRead: "Sieve couldn't read your requests. Sign out and in again.",
  expiredToast: (aiName: string) => `The request from ${aiName} expired before you answered it.`,
  revokedToast: (aiName: string) => `${aiName}'s connection was revoked, so its request was cancelled.`,
  mayOnlyReceive: (aiName: string, step: string) => `${aiName} may only receive ${step === 'answer' ? 'the answer' : 'an excerpt'}.`,
  waitingForClick: 'Waiting for you to click in this tab once',
  waitingHidden: 'Waiting for the Sieve tab: Chrome may slow the on-device model in background tabs.',
  /** The system notification while the tab is in the background holds a request up (70 R-PLAT-01). */
  inFrontTitle: 'Sieve needs to be in front',
  inFrontBody: (aiName: string) => `${aiName} is waiting. Open the Sieve tab so it can prepare the answer.`,
  prepareFailed: (aiName: string) => `Sieve couldn't prepare an answer for ${aiName}. It was told to try again later.`,
  blockedToast: (aiName: string) => `${aiName} asked for something your rules never share. Sieve told it no.`,
  modelUnavailableToast: (aiName: string) => `${aiName} asked, but this Chrome has no on-device model. Sieve told it to try later.`,
  newRequestAnnounce: (aiName: string, question: string) => `New request from ${aiName}: ${question}`,
  newRequestToast: (aiName: string) => `New request from ${aiName}`,
  review: 'Review',
  makeFailed: "Couldn't make this the home base. Check your connection and try again.",
  stopFailed: "Couldn't stop being the home base. Check your connection and try again.",
  relatedFailed: "Couldn't prepare this item.",
  sentAnnounce: (phrase: string, aiName: string) => `Sent ${phrase} to ${aiName}.`,
  deniedAnnounce: (aiName: string) => `Denied. ${aiName} was told you declined.`,
  approvedInExtension: (phrase: string, aiName: string) => `Approved in the extension. Sent ${phrase} to ${aiName}.`,
  deniedInExtension: 'Denied in the extension.',
  stoppedPreparing: 'Stopped. Nothing was shared.',
  discardedToast:
    'Chrome put this tab to sleep to save memory, so AIs couldn\'t reach Sieve. To keep it awake, open Chrome Settings › Performance and add this site to "Always keep these sites active".',
} as const;

/** Previews for the extension (40 section 11.10). */
export const PREVIEW_COPY = {
  notAvailable: "This step isn't available.",
  tooLong: 'Too long to send at once',
  untitled: 'Untitled item',
} as const;

/** Receipts (40 section 10.3). */
export const RECEIPTS_FLOW = {
  revokeFailed: "Couldn't revoke that. Check your connection and try again.",
} as const;

/** Delete my account (40 section 10.7). */
export const ACCOUNT_DELETE = {
  cancelled: "Your account wasn't deleted. Sign-in was cancelled.",
  done: 'Your account and data were deleted.',
  failed: "Couldn't delete your account. Try again.",
} as const;

/** The Playground store (40 section 13.9). */
export const PLAYGROUND_FLOW = {
  seedFailed: "Couldn't set up the sample data.",
  storageBlocked: "This browser blocks storage for this site, so the Playground can't run. Allow site data for this site and reload.",
  addFailed: "Couldn't add this item.",
  tooBig: (name: string) => `${name} is over 10 MB.`,
  unsupported: (name: string) => `${name} isn't a supported file. Try PDF, text or a photo.`,
  tooMany: 'Add up to 5 files at a time.',
} as const;

/** Sources actions (40 section 9.9). */
export const SOURCES_FLOW = {
  addFailed: "Couldn't add this file.",
} as const;
export * from './screens-main';
export * from './screens-controls';
