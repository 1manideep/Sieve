# Sieve implementation spec: 01 Contracts

The single source of truth for names, types, storage layout and message formats. TypeScript lives in `shared/src/` and is imported by `web/` and `extension/`. Python mirrors live in `functions/sieve/models.py` (Pydantic 2, camelCase aliases). Component specs may add private types inside their own modules but must not change anything here; if a change is needed, a component spec lists it under "Contract change requests".

## 1. Constants (`shared/src/constants.ts`)

```ts
export const CATEGORIES = ['Home', 'Work', 'Money', 'Health', 'Travel', 'Shopping', 'Personal', 'Newsletters', 'Photos'] as const;
export const LADDER_STEPS = ['answer', 'excerpt', 'full'] as const;          // ordered: low to high disclosure
export const DEFAULT_CATEGORY_RULES = {
  Home: 'approve', Work: 'approve', Money: 'ask-first', Health: 'never', Travel: 'approve',
  Shopping: 'approve', Personal: 'approve', Newsletters: 'approve', Photos: 'approve',
} as const;

export const RELAY_WAIT_SECONDS = 45;        // MCP tool call waits this long for an answer, then returns "pending"
export const REQUEST_TTL_HOURS = 24;         // Firestore TTL on request docs (field expireAt)
// Every character count in Sieve (limits, StepOption.chars, RelayPayload.chars, Receipt.chars, message limits) is in
// UTF-16 code units (JavaScript String.length). Python counts with len(s.encode('utf-16-le', 'surrogatepass')) // 2.
export const MAX_QUESTION_CHARS = 500;
export const MAX_PAYLOAD_CHARS = 8000;       // hard cap on any outgoing text
// TOP_K retired (v2): the pipeline reads up to VECTOR_K + KEYWORD_SAFETY_K candidates
export const RELATED_MAX = 3;                // related suggestions shown with a proposal
export const PREVIEW_CHARS = 280;
export const NANO_TOKEN_LIMIT = 9216;        // per call, from the Firebase docs
export const NANO_PROMPT_BUDGET = 7000;      // max input tokens we assemble, leaving room for output
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';   // local, ~23 MB q8, 384 dims (measured: best top-5 recall)
export const EMBEDDING_DIMS = 384;
export const CHUNK_WORDS = 160;              // long items are split into chunks of about this many words for vectors
export const VECTOR_K = 5;                   // vector shortlist size
export const KEYWORD_SAFETY_K = 2;           // keyword hits added to the shortlist for exact ids and names
export const GRANT_DEFAULT_DAYS = 30;
export const REAL_DB_NAME = 'sieve';
export const PLAYGROUND_DB_NAME = 'sieve-playground';
export const HOME_BASE_PORT_NAME = 'sieve-home-base';   // page-to-extension port name
export const EXTENSION_ID = 'REPLACE_AT_WP7_STEP_1';    // 32 letters a-p, derived from extension/manifest.json "key" (50 section 5)
export const RELAY_DECISION_MINUTES = 120;   // queued/claimed/awaiting-person older than this -> expired
export const RELAY_COLLECT_MINUTES = 60;     // an answered payload not collected by then -> expired
export const MESSAGE_VERSION = 1;
export const MCP_TOOLS = {
  answer: 'sieve_answer',
  excerpt: 'sieve_excerpt',
  full: 'sieve_full_item',
  check: 'sieve_check',
} as const;
```

## 2. Core types (`shared/src/types.ts`)

```ts
export type Category = typeof CATEGORIES[number];
export type CategoryRule = 'approve' | 'ask-first' | 'never';
export type LadderStep = typeof LADDER_STEPS[number];
export type SourceKind = 'gmail' | 'folder' | 'upload' | 'playground';
export type ItemKind = 'email' | 'document' | 'photo' | 'note';
export type Where = 'device' | 'cloud' | 'code';                    // where a step ran; 'code' = plain code, no model
export type InferenceModeName = 'ONLY_ON_DEVICE' | 'PREFER_ON_DEVICE' | 'PREFER_IN_CLOUD' | 'ONLY_IN_CLOUD';
export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

export interface Settings {
  categoryRules: Record<Category, CategoryRule>;
  defaultStep: LadderStep;                // 'answer' in the hackathon build
  cloudFallbackForOwnData: boolean;       // false by default; even when true, each request asks
  pushEnabled: boolean;
}

export type PiiType = 'email' | 'phone' | 'card' | 'iban' | 'ssn' | 'account' | 'name' | 'address' | 'dob' | 'other';
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

export type ProposalOutcome = 'ready' | 'blocked-never' | 'no-match' | 'needs-cloud-consent' | 'model-unavailable' | 'error';

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
  | 'queued' | 'claimed' | 'awaiting-person' | 'answered' | 'declined' | 'blocked' | 'no-match'
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
  message?: string;                       // declined/blocked/no-match/error (home base), expired/revoked (functions): one sentence the AI receives, at most 300 chars, never content
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
```

`Timestamp` is `firebase/firestore`'s `Timestamp` in web code; the shared package declares a minimal structural type `{ seconds: number; nanoseconds: number; toMillis(): number }` so `shared/` has no Firebase dependency.

## 3. Firestore layout

| Path | Who writes | Who reads | Notes |
|---|---|---|---|
| `users/{uid}` | owner | owner | `{ settings: Settings, createdAt, homeBaseDeviceId?: string }` |
| `users/{uid}/devices/{deviceId}` | owner | owner, functions | `{ label, fcmToken?, isHomeBase, updatedAt }` |
| `users/{uid}/requests/{requestId}` | functions (create, collect), owner (claim, answer, decline) | owner, functions | `RelayRequest`; TTL on `expireAt` |
| `users/{uid}/receipts/{receiptId}` | owner, functions (status updates) | owner | `Receipt`. For relay requests `receiptId = requestId`, created by the home base in the same batched write as the request update |
| `users/{uid}/grants/{grantId}` | functions only | owner | `GrantMeta` |
| `users/{uid}/blocked/{blockId}` | owner | owner | `{ recordId, grantId: string /* or '*' */, createdAt }`: items revoked for an AI; the home base refuses them |
| `connectors/{linkHash}` | functions only | functions only | `{ uid, grantId, token, identity: { agentId, fingerprint }, createdAt, expiresAt, revokedAt?, revokedRootIds: string[], revokedTokenIds: string[], rateWindowStart?, rateCount }` (serialized Ratchet token; no private key stored; never readable by clients) |
| `audit/{uid}` | functions only | owner | head doc `{ lastHash, seq }` |
| `audit/{uid}/entries/{seq}` | functions only | owner | Ratchet audit entries in Ratchet's canonical snake_case keys (`timestamp, delegation_chain, tool_name, args_digest, resource, decision, reason_code, token_id, prev_hash, entry_hash`) plus `seq` (zero-padded to 10 digits); grant lifecycle events (`sieve.grant.issued|narrowed|revoked`) are entries in the same chain |

Security rules are specified in 30-relay-server.md. The home base may only change a request's `status`, `claimedAt`, `claimedBy`, `answeredAt`, `response`, `message`, and only along allowed transitions.

## 4. Realtime Database layout

`/presence/{uid}/{deviceId}`: `{ state: 'online' | 'offline', isHomeBase: boolean, lastChanged: ServerValue.TIMESTAMP }`, set online on connect with an `onDisconnect` that sets offline. Functions treat a user as reachable when any device with `isHomeBase: true` is `online`.

## 5. IndexedDB layout (Dexie, `web/src/index/db.ts`)

Two databases with the same schema: `sieve` (real data) and `sieve-playground` (Playground). Code receives a `SieveDb` handle and never hardcodes the name.

| Store | Key | Indexes | Holds |
|---|---|---|---|
| `records` | `id` | `source, kind, category, date` | `IndexRecord` |
| `blobs` | `id` | | `{ id, blob: Blob, thumb?: Blob }` for uploads and Playground photos/documents |
| `search` | `id` | | `{ id: 'minisearch', json: string, updatedAt }` serialized MiniSearch index |
| `tombstones` | `id` | `deletedAt` | `{ id, deletedAt, reason: 'source-deleted' \| 'trashed' \| 'user-removed' \| 'disconnected' \| 'moved', movedTo?: string }` (`movedTo`: the new id when the same bytes appeared at another path in the same rescan, so blocks and receipts follow the move): ids deleted recently, so a late background job cannot bring them back; pruned after 30 days |
| `vectors` | `id` | `recordId` | `{ id: `${recordId}#${n}`, recordId, start, end, vector: Float32Array(EMBEDDING_DIMS), model: EMBEDDING_MODEL, recordVersion: number }`: one per chunk (captions for photos), normalized; brute-force cosine search |
| `sources` | `kind` | | `{ kind, connected, cursor?, lastSyncAt?, progress: { done, total }, paused, folderHandle?: FileSystemDirectoryHandle, needsAuth?, error?, errorCode?, folderName?, account?, phase?, skipped?, etaMs? }` |
| `receipts` | `id` | `createdAt` | `Receipt` (Playground only; real receipts are in Firestore) |
| `consents` | `recordId` | | `{ recordId, cloudAllowedAt }`: per-file cloud consent (Playground uploads, or own data when cloud fallback is on) |

## 6. Extension messages (`shared/src/messages.ts`)

Transport: the home base page opens a long-lived port with `chrome.runtime.connect(EXTENSION_ID, { name: HOME_BASE_PORT_NAME })`. The extension accepts it only from origins in its `externally_connectable.matches`. Every message has `version: MESSAGE_VERSION`; unknown types or versions are ignored.

```ts
export interface ProposalPreview {
  requestId: string;
  requester: RequesterRef;
  question: string;
  requestedStep: LadderStep;
  maxStep: LadderStep;
  item?: { title: string; kind: ItemKind; category: Category; date: number };
  options: StepOption[];
  rule: CategoryRule;
  warnings: Warning[];
  outcome: ProposalOutcome;
}

export type PageToExtension =
  | { type: 'sieve/hello'; version: 1; homeBase: boolean; appVersion: string }
  | { type: 'sieve/pending'; version: 1; proposals: ProposalPreview[] }   // the full current list every time: outside requests waiting for the person, oldest first, at most 20; re-sent every 20 s as a keepalive
  | { type: 'sieve/resolved'; version: 1; requestId: string; outcome: 'approved' | 'declined' | 'expired' | 'error' };  // 'error' only when nothing was written, so nothing was shared

export type ExtensionToPage =
  | { type: 'sieve/hello-ack'; version: 1; extensionVersion: string; shortcut?: string }   // shortcut: the open-sieve key binding from chrome.commands.getAll(), '' when unset (50 section 8.9)
  | { type: 'sieve/decision'; version: 1; decision: Decision }            // decidedBy must be 'extension'
  | { type: 'sieve/open-app'; version: 1; requestId?: string };
```

The page validates every `sieve/decision` against its own pending proposal (same requestId, step <= maxStep, option available) before acting. For `decidedBy: 'extension'`, `itemIds` is always `[]` and the page uses the main item only; related items can be added only in the app.

## 7. MCP tools (served by functions)

| Tool | Input | Ladder step |
|---|---|---|
| `sieve_answer` | `{ question: string, after?: string, before?: string, source?: 'mail' \| 'files' \| 'photos', from?: string, terms?: string[] }` (question 1 to 500 chars) | answer |
| `sieve_excerpt` | same as sieve_answer | excerpt |
| `sieve_full_item` | same as sieve_answer | full |
| `sieve_check` | `{ request_id: string }` | (collect a pending result) |

The optional fields map to `QueryHints` and are copied into the request doc as `hints`. The server sends MCP `instructions` at initialize telling the assistant to: restate the person's question as a clear, self-contained question in plain words (fix typos, resolve pronouns from the chat); resolve relative dates against today and send them as `after`/`before` in YYYY-MM-DD; put exact identifiers in `terms`; start with `sieve_answer` and ask for more only when the answer is not enough; never ask Sieve to perform actions; tell the person to approve in Sieve when a result is `pending`, then call `sieve_check`.

Every tool returns MCP `content: [{ type: 'text', text }]` and `structuredContent`:

```ts
export interface ToolResult {
  status: 'answered' | 'pending' | 'declined' | 'blocked' | 'no-match' | 'offline' | 'expired' | 'not-allowed' | 'error';
  request_id?: string;
  step?: LadderStep;
  text?: string;          // the approved payload text, only when status = 'answered'
  message: string;        // one sentence for the assistant, e.g. "Waiting for the person's approval in Sieve. Call sieve_check with this request_id in a minute."
}
```

When the delivered payload has an `image`, the result `content` is `[{ type: 'text', text }, { type: 'image', data: image.base64, mimeType: 'image/jpeg' }]`.

Ratchet enforces, per call on the server: the tool (so the step cap), the grant's expiry and revocation. Categories and sources are enforced on the device from `allowedCategories` / `allowedSources` copied into the request.

## 8. Python mirrors (`functions/sieve/models.py`)

Pydantic 2 models `RelayRequest`, `RelayPayload`, `Receipt`, `GrantMeta`, `ConnectorDoc`, `ToolResult`, with `model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)` so Firestore fields stay camelCase. `ToolResult` keeps snake_case (`request_id`) because it is MCP output, not Firestore.

## 9. Module interfaces (agreed between component specs)

Each owning spec defines these exactly; other specs call them as written. Owners may add optional fields, never remove or rename.

```ts
// web/src/ai/  (owner: 10-ai-layer)
export type PromptPart = { type: 'text'; text: string } | { type: 'image'; blob: Blob };
export type DataClass = 'own' | 'sample' | 'approved';   // whose data is in the prompt; drives the fallback policy
export interface RunModelArgs {
  purpose: 'label' | 'select-answer' | 'caption' | 'draft' | 'injection-check' | 'pii-check';
  mode: InferenceModeName;
  data: DataClass;
  prompt: string | PromptPart[];          // one single-turn prompt
  system?: string;
  schema?: object;                        // JSON schema for structured output
  recordIds?: string[];                   // checked against per-file cloud consent
  signal?: AbortSignal;
  timeoutMs?: number;
}
export type ModelErrorCode = 'unavailable' | 'downloading' | 'needs-consent' | 'cloud-not-allowed' | 'too-long' | 'bad-output' | 'timeout' | 'aborted' | 'app-check' | 'quota' | 'unknown';
export type RunModelResult<T> =
  | { ok: true; value: T; trace: TraceStep }
  | { ok: false; error: { code: ModelErrorCode; message: string }; trace: TraceStep };
export function runModel<T>(args: RunModelArgs): Promise<RunModelResult<T>>;
export function getNanoAvailability(): Promise<{ text: NanoAvailability; image: NanoAvailability }>;
export function labelBatch(items: Pick<IndexRecord, 'id' | 'title' | 'from' | 'preview' | 'kind'>[], data: DataClass): Promise<{ labels: Record<string, Category>; trace: TraceStep }>;
export function selectAndAnswer(question: string, records: IndexRecord[], data: DataClass): Promise<RunModelResult<{ recordId: string | null; answer: string; excerpt: string }>>;
export function captionPhoto(blob: Blob, data: DataClass): Promise<RunModelResult<{ caption: string }>>;
export function draftReply(approvedText: string, instruction: string): Promise<RunModelResult<{ draft: string }>>;

// web/src/pipeline/  (owner: 10-ai-layer) — the orchestration from question to Proposal
export interface PrepareInput {
  db: SieveDb;
  requestId: string;
  question: string;
  requester: RequesterRef;
  requestedStep: LadderStep;
  maxStep: LadderStep;
  allowedCategories?: Category[];
  allowedSources?: SourceKind[];
  hints?: QueryHints;                     // from the assistant's tool call, or parsed from the question in-app
  settings: Settings;
  dataClass: 'own' | 'sample';
  signal?: AbortSignal;
}
export function prepareProposal(input: PrepareInput): Promise<Proposal>;
export function finalizeDecision(proposal: Proposal, decision: Decision): Promise<{ payload: RelayPayload | null; receipt: Receipt }>;

// web/src/index/  (owner: 20-index-and-sources)
export interface SieveDb { /* Dexie database with the stores in section 5 */ }
export function openDb(kind: 'real' | 'playground'): SieveDb;
export function search(db: SieveDb, question: string, opts?: { k?: number; sources?: SourceKind[]; categories?: Category[]; hints?: QueryHints }): Promise<Candidate[]>;  // vector top VECTOR_K, plus keyword top KEYWORD_SAFETY_K, deduped; hints boost (not filter) by date and source
export function parseQuestion(question: string, now: Date, locale: string): { normalized: string; corrected: string; hints: QueryHints };  // owner: 20-index; typo correction against index vocabulary + dictionary, date parsing with ambiguity flags
export function getRecord(db: SieveDb, id: string): Promise<IndexRecord | undefined>;
export function relatedFor(db: SieveDb, recordId: string, question: string): Promise<Candidate[]>;
export interface RawItem { source: SourceKind; sourceRef: string; kind: ItemKind; title: string; from?: string; threadId?: string; date: number; html?: string; text?: string; blob?: Blob }
export function ingest(db: SieveDb, raw: RawItem, data: 'own' | 'sample'): Promise<IndexRecord>;
export function removeRecord(db: SieveDb, id: string, reason: 'source-deleted' | 'trashed' | 'user-removed' | 'disconnected' | 'moved', opts?: { movedTo?: string }): Promise<void>;  // section 10 invariant 4
export function verifyFresh(db: SieveDb, id: string): Promise<'ok' | 'gone' | 'changed' | 'unknown'>;  // 'unknown': the source could not be reached (e.g. Gmail token expired); answer from the local copy with a warning  // section 10 invariant 8; 'gone'/'changed' also update the index

// web/src/privacy/  (owner: 11-privacy-pipeline)
export function sanitizeIncoming(raw: { html?: string; text?: string }): { text: string; hiddenRemoved: string[] };
export function detectPii(text: string, data: DataClass): Promise<{ spans: PiiSpan[]; trace: TraceStep[] }>;
export function redact(text: string, spans: PiiSpan[]): { text: string; redactions: number };
export function checkInjection(text: string, data: 'own' | 'sample'): Promise<{ finding: InjectionFinding; trace: TraceStep }>;
export function buildStepOption(step: LadderStep, parts: { answer?: string; excerpt?: string; full?: string }, record: IndexRecord, data: DataClass): Promise<StepOption>;
```


## 10. Index consistency invariants (all specs must respect these)

Identity
1. A record's id is `${source}:${sourceRef}`. For Gmail, `sourceRef` is the Gmail message id (unique and permanent). For the local folder, it is the path relative to the granted folder, so `taxes/2025/W-2.pdf` and `old/W-2.pdf` are different records even with the same file name. For uploads it is a random id assigned at upload. For the Playground it is the seed id.
2. `contentHash` tells "same place, new content" apart from "nothing changed": a file re-downloaded to the same path with different bytes is the same id with a new hash, so it is re-indexed (old chunks, vectors and keyword entries removed first). Same bytes means nothing to do.
3. The same content at two paths is two records (both real files). Results are de-duplicated by `contentHash` at display time ("also in old/").

Deletion
4. Deleting a record is one Dexie transaction across `records`, `vectors` (all rows with that recordId), `blobs`, the keyword index entry, and `consents`, plus a `tombstones` row. There is no state where the record is gone but its vectors remain, or the reverse.
5. Deletions are detected per source: Gmail through history (messagesDeleted, and the TRASH or SPAM label added counts as deleted) with a full id reconciliation when the history id has expired; the folder through a rescan that diffs stored paths against what is on disk (on app focus, on a timer, and before indexing new files); uploads and Playground items through Sieve's own UI.

Races
6. Every background job (label, caption, embed, privacy scan) records the `version` it read. Its write runs in a transaction that first checks the record still exists with that same version and the id is not tombstoned; otherwise the result is thrown away. A deleted or re-indexed item can never be brought back by a job that started before.

Retrieval and sharing (defence in depth)
7. Every candidate from the vector or keyword index is resolved with `getRecord`; a hit whose record does not exist is dropped and its orphan rows are deleted (logged as an integrity repair).
8. Before a proposal is shown, the chosen item is checked against its source: the Gmail message still exists and is not in Trash or Spam; the local file still exists with the same `contentHash` (or is re-read and re-checked). If not, the item is removed from the index and the proposal moves to the next candidate or reports no match.
9. On startup and after an upgrade, a cheap integrity check compares counts (records vs distinct recordIds in vectors vs keyword index size); a mismatch triggers a background repair or rebuild.

## 11. Reconciliation v2 (Nov 16): decisions on every component spec's change requests

Where a component spec disagrees with this section, **this section wins**; the owning spec's behaviour stays as written except for the names and ownership below. Everything not mentioned here was accepted as the owning spec wrote it.

### 11.1 One background queue (conflict: 10, 11 and 20 each proposed one)
- **Owner: 20.** `startIngestQueue(db, opts)` in `web/src/index/` is the only background queue: newest first, priority below questions, preemption by AbortSignal, versioned writes, progress and ETA.
- **10** provides task functions only (`labelBatch`, `captionPhoto`) and the foreground/background priority inside `runModel`. `startEnrichment` / `nudgeEnrichment` in `web/src/pipeline/enrich.ts` are thin re-exports of 20's queue, kept so 40's names work.
- **11** provides `scanRecord(record, opts): Promise<ScanPatch>` as a task handler that 20's queue runs; 11's own `PrivacyScanQueue` is not built. `scanNow` stays as a foreground call.
- **The version-checked write** is 20's `patchRecord(db, id, version, patch): Promise<'ok' | 'gone' | 'stale'>`. 10's proposed `updateRecordIfVersion` is the same thing under 20's name; 11's `ScanQueueDeps.save` goes through it.
- **`ingest()` makes no model calls**: sanitize, validators, `codeLabel` (category, `categoryBy: 'code'`), contentHash, chunks; embeddings, Nano labels, captions and privacy model passes run in the queue.
- **One ML worker** (`web/src/ml/`, owner 20) hosts both MiniLM embeddings and 11's PII model (`web/src/privacy/model/pii.task.ts`).

### 11.2 Versions on the record (conflict: 10 `enrich`, 11 `privacyScan`, 20 `promptVersion`)
- `enrich` (label, caption) and `privacyScan` (injection, PII) are both on `IndexRecord` (section 2). 20's `promptVersion` is dropped: use `enrich[task].v`.

### 11.3 Keywords
- Rejected: `IndexRecord.keywords` and keyword output from `labelBatch`. Vectors close the vocabulary gap (measured). 10 removes the keyword part of its label prompt and schema.

### 11.4 Names between 10 and 40
- `downloadNano(opts)` (10) is the setup call; 40's `initDeviceModel` is not added (40 calls `downloadNano`). Also from 10: `initAi`, `getNanoState`, `subscribeNano`, `setNanoSimulation`, `PROMPT_VERSIONS`, `codeLabel`, `isHealthStrong`, `RunModelArgs.priority`.
- `buildRelatedOptions(input: { db: SieveDb; proposal: Proposal; recordId: string; dataClass: 'own' | 'sample'; signal?: AbortSignal }): Promise<StepOption[]>` (object form, 40's shape).
- `composeOutgoingText(options: StepOption[]): string`, pure, the only builder of outgoing text with related items.
- `finalizeDecision(proposal, decision, extras?: { relatedOptions?: Record<string, StepOption[]> }): Promise<{ payload: RelayPayload | null; receipt: Receipt; approveStep?: TraceStep }>` is **pure: it persists nothing**. The caller persists: relay requests with one batched write of the request update plus the receipt (`receiptId = requestId`); in-app own data writes the receipt to Firestore; the Playground writes it to IndexedDB. A `blocked-never` proposal yields `status: 'blocked'`, `decidedBy: 'rule'`, `chars: 0`. Throws `DecisionError` on validation failure.
- `PrepareInput` gains `onProgress?: (e: PipelineProgress) => void`, `blockedRecordIds?: string[]`, `ownWithoutConsent?: 'ask' | 'skip'`, `now?: number`; `PipelineProgress` is 40's type (step-start, step-end, answer-progress).
- 11's optional `opts` parameters are accepted; 10's `allowNano?: boolean` is a field inside those option objects (default true; the pipeline passes false at question time).

### 11.5 Callables and push (conflict: 40 vs 30)
- Callable names are 30's: `issueGrant`, `narrowGrant`, `revokeGrant`, `getAuditStatus`, `deleteAccount` (40 renames `createGrant` and `verifyAudit`). `issueGrant` input `{ aiName, maxStep, allowedCategories, allowedSources, days? }` (days 1 to 90, the UI offers 7, 30, 90); output `{ grantId, link, linkHint, maxStep, allowedCategories, allowedSources, expiresAt }` (40 reads `link`, not `connectorUrl`). The link is returned only here.
- **Push target: open.** 40 says the web `getToken` is obsolete and uses `onRegistered` (a Firebase Installation ID); 30 sends to registration tokens in `fcmToken`. Verify at implementation (WP6/WP5): which target the current Admin SDK `messaging().send` accepts for web, then both specs use that; the device field stays `fcmToken` holding whatever that target is. Payload as 40 CR-5: title "Sieve", body "A request is waiting", link `/requests`, `data: { kind: 'request-waiting' }`, nothing else.

### 11.6 Request transitions the home base may write (30's table wins, plus one row)
- As in 30 section 9.1 (`queued → claimed`, `claimed → awaiting-person`, `claimed → no-match | blocked | error`, `awaiting-person → answered | declined | error`), plus **`answered → revoked` by the home base** (response deleted) so revoking a receipt before collection also stops the uncollected payload. 30 adds this row to the rules and its tests.

### 11.7 Other accepted items
- `SharedImage` on `StepOption` and `RelayPayload` (photos, full step, at most 600 KB JPEG so the request doc stays under 1 MiB); MCP delivers it as an image content block (section 7).
- `shared/src/copy.ts` (owner 40) holds the ladder labels, warning titles and result lines used by both the app and the extension.
- The MCP Python SDK is a test dependency only; `ratchet-authz-mcp` is not a runtime dependency (the server is hand-written stateless JSON).
- Firebase JS SDK pinned to `13.3.0` (10 CR-6).
- Decision 12 wording: "exactly one Nano call (one more only when the chosen item turns out deleted or changed at its source, invariant 8)".
- The optional Playground outside assistant (30 section 16), if built, is an exception to decision 10: an approved payload from sample data passes through Firestore for a few seconds.

### 11.8 From the failure-mode catalog (70-robustness)
- **No file paths or item ids in Firestore.** Receipts and `blocked` docs store `itemRefs`: `HMAC-SHA256(localSalt, recordId)` hex, where `localSalt` is a random 32-byte value kept only in IndexedDB on the home base; titles and ids are joined locally. (`Receipt.itemIds` and `blocked.recordId` are local-only names; their Firestore form is `itemRefs` / `recordRef`.) Folder paths like `taxes/2025/W-2.pdf` would otherwise reach the server.
- **Gmail tokens expire after about an hour, and nobody is there to click.** Answers come from the local copy of mail already in IndexedDB; only `verifyFresh` and new-mail sync need Gmail. With an expired token, `verifyFresh` returns `'unknown'`, the proposal carries the `source-unchecked` warning ("Sieve couldn't check that this email still exists; it used the copy on this computer."), and the status strip says "Reconnect Gmail to get new mail". Relay answers keep working.
- **Proposals are re-checked at send time:** a grant narrowed, a rule changed or an item blocked after a proposal opened invalidates it; `finalizeDecision` re-validates against the current grant scope, rules and blocks.
- **App Check on Firestore and RTDB: monitor, do not enforce, for the hackathon build** (decision on a conflict between 30 and 70): a reCAPTCHA hiccup must never stop the home base. App Check stays enforced on Firebase AI Logic (required) and on the callables; Firestore and RTDB are protected by the owner-only security rules. Revisit after judging.
- Accepted as written in 70: one character unit everywhere (section 1), tombstones remember moves, the `unverified-answer` warning when a fact in the answer is not found in the item, the repo layout additions (`web/src/robust/`, `tests/fixtures/robustness/`, `tests/harness/`), image decompression-bomb limits, listener liveness checks for the home base, and the hidden or discarded tab handling.
