// Contract constants (docs/spec/01-contracts.md section 1). Change them only through a contract change.

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
export const EXTENSION_ID = 'ackgioeokfkdnehjoaoeldnpgodhljcc';    // 32 letters a-p, derived from extension/manifest.json "key" (50 section 5)
export const RELAY_DECISION_MINUTES = 120;   // queued/claimed/awaiting-person older than this -> expired
export const RELAY_COLLECT_MINUTES = 60;     // an answered payload not collected by then -> expired
export const MESSAGE_VERSION = 1;
export const MCP_TOOLS = {
  answer: 'sieve_answer',
  excerpt: 'sieve_excerpt',
  full: 'sieve_full_item',
  check: 'sieve_check',
} as const;
