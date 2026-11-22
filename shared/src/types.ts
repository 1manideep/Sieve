// Core types (docs/spec/01-contracts.md section 2, plus the MCP ToolResult of section 7).
import type { CATEGORIES, LADDER_STEPS, MCP_TOOLS } from './constants';

/**
 * Firestore's Timestamp, declared structurally so this package has no Firebase dependency.
 * Web code passes `firebase/firestore` Timestamps, which satisfy it.
 */
export interface Timestamp {
  seconds: number;
  nanoseconds: number;
  toMillis(): number;
}

export type Category = typeof CATEGORIES[number];
export type CategoryRule = 'approve' | 'ask-first' | 'never';
export type LadderStep = typeof LADDER_STEPS[number];
export type SourceKind = 'gmail' | 'folder' | 'upload' | 'playground';
export type ItemKind = 'email' | 'document' | 'photo' | 'note';
export type Where = 'device' | 'cloud' | 'code';                    // where a step ran; 'code' = plain code, no model
export type InferenceModeName = 'ONLY_ON_DEVICE' | 'PREFER_ON_DEVICE' | 'PREFER_IN_CLOUD' | 'ONLY_IN_CLOUD';
export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

/** Whose data is in a prompt; drives the fallback policy. Declared by web/src/ai (01 section 9) and shared here for 11's types. */
export type DataClass = 'own' | 'sample' | 'approved';

export interface Settings {
  categoryRules: Record<Category, CategoryRule>;
  defaultStep: LadderStep;                // 'answer' in the hackathon build
  cloudFallbackForOwnData: boolean;       // false by default; even when true, each request asks
  pushEnabled: boolean;
}

export type PiiType = 'email' | 'phone' | 'card' | 'iban' | 'ssn' | 'account' | 'name' | 'address' | 'dob' | 'secret-code' | 'other';   // secret-code: one-time codes and sign-in links (11 section 5.2)
export interface PiiSpan {
  start: number; end: number;             // offsets into the sanitized text
  type: PiiType;
  by: 'validator' | 'model' | 'nano';
  score?: number;                         // model confidence 0..1 when available
}

export interface InjectionFinding {
  suspicious: boolean;
  quote?: string;                         // the suspicious sentence, for showing the person
  by: 'code' | 'nano';
}

export interface PhotoMeta { takenAt?: number; place?: string; width: number; height: number; mime: string; hadGps: boolean }

// Privacy scan stamps (docs/spec/11-privacy-pipeline.md section 2.3), exported from shared per 01 section 2.
export type PiiStage = 'validators' | 'model' | 'nano';
export interface KnownEntity { text: string; type: PiiType; by: PiiSpan['by']; score?: number }
export interface ScanStageStamp { version: string; ran: 'code' | 'device' | 'cloud'; ms: number; at: number }
export interface PrivacyScanStamp {
  textHash: string;                       // hash of the scanned text and hiddenRemoved
  pii: Partial<Record<PiiStage, ScanStageStamp>>;
  injection: Partial<Record<'code' | 'nano', ScanStageStamp>>;
  headerEntities: KnownEntity[];          // personal details found in the sender name and subject
}

/** One indexed item. Lives only in IndexedDB on the device. */
export interface IndexRecord {
  id: string;                             // `${source}:${sourceRef}`
  source: SourceKind;
  sourceRef: string;                      // Gmail message id | path inside the granted folder | upload id | seed id
  kind: ItemKind;
  title: string;                          // email subject or file name
  from?: string;                          // "Name <address>" for email
  threadId?: string;
  date: number;                           // epoch ms
  preview: string;                        // sanitized, <= PREVIEW_CHARS
  text?: string;                          // sanitized full text (emails, documents, notes); absent for photos
  caption?: string;                       // photos: one sentence
  captionBy?: Where | 'seed';
  photo?: PhotoMeta;
  category: Category;
  bulk?: boolean;                         // the source filed it as sent to many (Gmail's Promotions, Social and Forums tabs)
  categoryBy: Where | 'seed' | 'rule';
  hiddenRemoved: string[];                // hidden fragments removed by plain code (kept locally to show the person)
  injection?: InjectionFinding;
  pii: PiiSpan[];
  sizeBytes: number;
  indexedAt: number;
  contentHash: string;                    // SHA-256 hex of the source bytes (files, photos) or of the fetched message fields (email; 20 section 5.2)
  version: number;                        // increments on every re-index of this id; background jobs carry it (see section 10)
  sourceModifiedAt?: number;              // file lastModified or Gmail internalDate, epoch ms
  mentionedDays?: string[];               // 'YYYY-MM-DD' dates mentioned in the text (max 30), for date-hint boosts
  enrich?: Partial<Record<EnrichTask, EnrichMark>>;   // which background model passes ran (label, caption), with prompt versions
  privacyScan?: PrivacyScanStamp;         // which privacy checks ran on this exact text, with versions (types defined in 11 section 2.3, exported from shared)
}

export type EnrichTask = 'label' | 'caption';
export interface EnrichMark { v: number; by: Where | 'seed' | 'code'; sdk?: 'on_device' | 'in_cloud'; at: number; ms?: number; confidence?: 'high' | 'low'; attempts?: number }

/** Optional search hints. Outside assistants fill these (instructed by the MCP server); in-app questions get them from Sieve's own query parser (dates, sources, people). */
export interface QueryHints {
  after?: string;                         // 'YYYY-MM-DD', inclusive
  before?: string;                        // 'YYYY-MM-DD', inclusive
  source?: 'mail' | 'files' | 'photos';
  categories?: Category[];                // one or two, from an outside assistant only: Sieve then looks only there (with a fallback)
  from?: string;                          // a person or organisation, as the person said it
  terms?: string[];                       // exact terms: order numbers, flight numbers, names (max 5)
  interpreted?: { text: string; as: string; ambiguous: boolean }[];  // e.g. { text: '1-2-2026', as: '2026-01-02', ambiguous: true }, shown to the person
}

export interface Candidate {
  recordId: string;
  score: number;
  matchedBy: 'vector' | 'keyword' | 'gmail-search' | 'caption';
  chunk?: { start: number; end: number };  // the best-matching chunk in the record text, when matched by vector
  reason: string;                         // one line for the person, e.g. "2 months ago: mentions the deposit amount"
}

export type TraceKind =
  | 'retrieve' | 'rule' | 'select' | 'answer' | 'excerpt' | 'clean' | 'pii' | 'injection'
  | 'approve' | 'draft' | 'caption' | 'label' | 'deliver';

export interface TraceStep {
  kind: TraceKind;
  label: string;                          // plain sentence shown in the trace, e.g. "Keyword search narrowed 30 emails to 3"
  where: Where;                           // device | cloud | code | (approve uses 'device')
  modeRequested?: InferenceModeName;      // set for model calls
  sdkReported?: 'on_device' | 'in_cloud'; // exactly what the SDK said; where is derived from this for model calls
  model?: string;
  ms: number;
  charsSent?: number;                     // characters that left the device in this step
  at: number;                             // epoch ms
}

export type RequesterRef =
  | { kind: 'in-app'; aiName: 'Gemini (in Sieve)' }
  | { kind: 'outside'; grantId: string; aiName: string };

export type WarningKind = 'ask-first' | 'injection' | 'hidden-text-removed' | 'pii-redacted' | 'pii-check-limited' | 'cloud-fallback' | 'sample-data-cloud' | 'unverified-answer' | 'source-unchecked';
export interface Warning { kind: WarningKind; message: string }

export interface StepOption {
  step: LadderStep;
  text: string;                           // the exact outgoing text for this step (what the person sees is what is sent)
  chars: number;
  redactions: number;
  available: boolean;                     // false when above maxStep or not producible
  unavailableReason?: string;
  image?: SharedImage;                    // photos, full step only: re-encoded JPEG without EXIF/GPS, at most 600 KB
  trace?: TraceStep[];                    // what ran to build this text
}

export interface SharedImage { mime: 'image/jpeg'; base64: string; width: number; height: number; bytes: number }

export type ProposalOutcome = 'ready' | 'blocked-never' | 'no-match' | 'unsupported' | 'needs-cloud-consent' | 'model-unavailable' | 'error';   // unsupported: a count (10 section 12.4)

/** What the home base prepares for the person to approve. Local only (the extension gets a preview). */
export interface Proposal {
  requestId: string;
  requester: RequesterRef;
  question: string;
  requestedStep: LadderStep;              // outside: implied by the tool; in-app: defaultStep
  maxStep: LadderStep;                    // outside: from the grant; in-app: 'full'
  item?: { recordId: string; title: string; kind: ItemKind; category: Category; date: number; from?: string };
  related: Candidate[];
  options: StepOption[];                  // always three entries, in LADDER_STEPS order
  rule: CategoryRule;
  warnings: Warning[];
  trace: TraceStep[];
  outcome: ProposalOutcome;
  createdAt: number;
  /** Outcome 'error' only: which step failed, as a short fixed code with no content (for example "model-timeout"). */
  errorCode?: string;
  /** Why nothing is shared (no-match, unsupported), as a short fixed code with no content. A testing aid. */
  reasonCode?: string;
}

export interface Decision {
  requestId: string;
  approved: boolean;
  step?: LadderStep;                      // required when approved; must be <= maxStep
  itemIds: string[];                      // the main item plus any related items the person ticked
  decidedBy: 'app' | 'extension';
  decidedAt: number;
}

/** What actually leaves the device for an outside assistant. Equals the approved StepOption text. */
export interface RelayPayload { step: LadderStep; text: string; chars: number; itemCount: number; image?: SharedImage }

export type RequestStatus =
  | 'queued' | 'claimed' | 'awaiting-person' | 'answered' | 'declined' | 'blocked' | 'no-match' | 'unsupported'
  | 'collected' | 'expired' | 'revoked' | 'offline' | 'error';

/** Firestore users/{uid}/requests/{requestId}. Written by functions (create) and the home base (claim/answer). */
export interface RelayRequest {
  requester: Extract<RequesterRef, { kind: 'outside' }>;
  tool: typeof MCP_TOOLS[keyof typeof MCP_TOOLS];
  requestedStep: LadderStep;
  maxStep: LadderStep;
  allowedCategories: Category[];          // copied from the grant; enforced on the device
  allowedSources: SourceKind[];           // copied from the grant; enforced on the device
  question: string;
  hints?: QueryHints;
  status: RequestStatus;
  createdAt: Timestamp;                   // firebase Timestamp
  claimedAt?: Timestamp;
  answeredAt?: Timestamp;
  collectedAt?: Timestamp;
  expireAt: Timestamp;                    // TTL field: createdAt + REQUEST_TTL_HOURS
  claimedBy?: string;                     // deviceId of the home base
  response?: RelayPayload;                // present only between answer and collection
  message?: string;                       // declined/blocked/no-match/unsupported/error (home base), expired/revoked (functions): one sentence the AI receives, at most 300 chars, never content
}

export type ReceiptStatus = 'pending-collection' | 'delivered' | 'declined' | 'blocked' | 'revoked' | 'expired';

/** Firestore users/{uid}/receipts/{receiptId} (real data) or IndexedDB receipts (Playground). Never holds content. */
export interface Receipt {
  id: string;
  requestId: string;
  requester: RequesterRef;
  question: string;                       // the request text (already known to the requester)
  step?: LadderStep;
  itemIds: string[];                      // IndexRecord ids; titles are joined locally from IndexedDB
  status: ReceiptStatus;
  decidedBy?: 'app' | 'extension' | 'rule';
  chars: number;                          // characters that left the device
  createdAt: number;                      // epoch ms (Timestamp in Firestore)
}

/** Firestore users/{uid}/grants/{grantId}. Client-readable, written only by functions. */
export interface GrantMeta {
  aiName: string;
  maxStep: LadderStep;
  allowedCategories: Category[];
  allowedSources: SourceKind[];
  createdAt: Timestamp;
  expiresAt: Timestamp;
  revokedAt?: Timestamp;
  lastUsedAt?: Timestamp;
  linkHint: string;                       // last 4 characters of the connector link secret, for recognising it
}

/** MCP tool result (01 section 7). snake_case because it is MCP output, not Firestore. */
export interface ToolResult {
  status: 'answered' | 'pending' | 'declined' | 'blocked' | 'no-match' | 'unsupported' | 'offline' | 'expired' | 'unknown' | 'not-allowed' | 'error';
  request_id?: string;
  step?: LadderStep;
  text?: string;          // the approved payload text, only when status = 'answered'
  message: string;        // one sentence for the assistant, e.g. "Waiting for the person's approval in Sieve. Call sieve_check with this request_id in a minute."
}

/** MCP ladder tool arguments (01 section 7); they map to QueryHints. */
export interface LadderToolInput {
  question: string;
  after?: string;
  before?: string;
  source?: 'mail' | 'files' | 'photos';
  categories?: Category[];    // one or two
  from?: string;
  terms?: string[];
  idempotency_key?: string;   // 1 to 64 characters: a retry with the same key returns the same request (30 section 9.4)
}

/** MCP sieve_check arguments (01 section 7). */
export interface CheckToolInput {
  request_id: string;
}
