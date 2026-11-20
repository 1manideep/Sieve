// Constants of the index and sources (20 section 3). Contract constants come from @sieve/shared.
import { CHUNK_WORDS, EMBEDDING_MODEL } from '@sieve/shared';

const MB = 1024 * 1024;

// Database
export const DB_VERSION = 1;
export const TOMBSTONE_TTL_DAYS = 30;
export const MAX_TEXT_CHARS = 100_000;
export const INDEX_TEXT_CHARS = 20_000;          // keyword index reads the first N chars of text
export const SEARCH_SAVE_DEBOUNCE_MS = 3_000;
export const SEARCH_SAVE_MAX_WAIT_MS = 15_000;
export const INTEGRITY_REBUILD_RATIO = 0.1;       // more than 10% mismatched ids: rebuild instead of repair
export const TITLE_MAX_CHARS = 300;
export const HIDDEN_FRAGMENT_MAX_CHARS = 500;
export const HIDDEN_FRAGMENTS_MAX = 20;
export const SOURCE_REF_MAX_CHARS = 512;

// Chunks and vectors
export const CHUNK_OVERLAP_MAX_WORDS = 40;        // repeat the previous chunk's last sentence if it is this short or shorter
export const MAX_CHUNKS_PER_RECORD = 64;
export const EMBED_BATCH = 16;                    // texts per worker call
export const CHUNKER_VERSION = 1;                 // part of SEARCH_FINGERPRINT; bump DB_VERSION when it changes
export const DEFAULT_CHUNK_WORDS = CHUNK_WORDS;

/** Everything the keyword snapshot and the vectors depend on (20 section 4.2). Pinned to DB_VERSION by A-DB-3. */
export const SEARCH_FINGERPRINT = 'kw1|chunk' + CHUNKER_VERSION + '|' + EMBEDDING_MODEL;

// Search
export const GMAIL_LIVE_K = 2;                    // live Gmail ids added after vector and keyword hits
export const MAX_PER_THREAD = 2;
export const BOOST = { dateRecord: 0.06, dateMentioned: 0.05, source: 0.04, from: 0.08, term: 0.10, recency: 0.02, latest: 0.06 } as const;
export const REASON_MAX_CHARS = 90;
export const RELATED_MIN_COSINE = 0.5;

// Typos
export const TYPO_MIN_LEN = 3;

// Background queue
export const LABEL_BATCH_SIZE = 10;
export const STAGE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];
export const COST_PRIOR_SEC = { label: 0.8, caption: 10, embed: 0.015 } as const;   // per item (embed: per chunk)
export const COST_EWMA_ALPHA = 0.2;
export const QUEUE_IDLE_RECHECK_MS = 60_000;
export const SOURCE_ROW_WRITE_MS = 500;

// Photos
export const THUMB_MAX_EDGE = 320;
export const STORAGE_PAUSE_RATIO = 0.9;
export const MAX_IMAGE_PIXELS = 100_000_000;      // 70 R-FILE-08
export const IMAGE_UNKNOWN_DIMS_MAX_BYTES = 10 * MB;

// Gmail
export const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const GIS_LOAD_TIMEOUT_MS = 15_000;
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GMAIL_BACKFILL_QUERY = 'newer_than:6m -in:chats -in:drafts';
export const GMAIL_RECONCILE_QUERY = '-in:chats -in:drafts';
export const GMAIL_LIST_PAGE = 500;
export const GMAIL_UNITS_PER_MINUTE = 4_800;      // 80% of the 6,000 units per user per minute limit
export const GMAIL_BUCKET_CAPACITY = 600;
export const GMAIL_MAX_CONCURRENCY = 4;
export const GMAIL_COST = { profile: 1, list: 5, history: 2, get: 20, getFull: 60 } as const;
export const GMAIL_BODY_BACKFILL_MAX = 2_000;
export const GMAIL_SYNC_INTERVAL_MS = 5 * 60_000;
export const GMAIL_RECONCILE_EVERY_MS = 7 * 86_400_000;
export const GMAIL_LIVE_MAX = 10;
export const GMAIL_LIVE_FETCH_NEW_MAX = 2;
export const GMAIL_LIVE_TIMEOUT_MS = 5_000;
export const GMAIL_HYDRATE_TIMEOUT_MS = 4_000;
export const GMAIL_TOKEN_SKEW_MS = 60_000;
export const GMAIL_QUERY_MAX_CHARS = 400;
export const BACKOFF = { baseMs: 1_000, maxMs: 32_000, maxAttempts: 6, jitterMs: 1_000 } as const;
export const MIME_MAX_DEPTH = 20;                 // 70 R-MAIL-01
export const MIME_MAX_PARTS = 300;

// Folder and uploads
export const FOLDER_MAX_FILES = 5_000;
export const FOLDER_MAX_ENTRIES = 20_000;         // 70 R-IDX-16: paths collected for the deletion diff
export const FOLDER_MAX_DEPTH = 8;
export const FOLDER_RESCAN_MS = 10 * 60_000;
export const FOLDER_FOCUS_RESCAN_MS = 2 * 60_000;
export const MAX_BYTES = { text: 5 * MB, json: 5 * MB, pdf: 30 * MB, image: 30 * MB } as const;
export const PDF_MAX_PAGES = 200;
export const PDF_TIMEOUT_MS = 30_000;             // 70 R-FILE-03
export const VERIFY_HASH_SKIP_BYTES = 10 * MB;    // 20 section 5.9: larger files with equal size and time skip hashing
export const UPLOAD_MAX_BYTES = 10 * MB;          // matches 40's copy "{name} is over 10 MB."
export const UPLOAD_MAX_FILES = 5;                // matches 40's copy "Add up to 5 files at a time."
export const UPLOAD_ACCEPT = '.txt,.md,.pdf,.json,.jpg,.jpeg,.png,.webp';

// Playground (20 section 18.1). PLAYGROUND_NOW lives here so clockFor needs no import from playground/.
export const PLAYGROUND_NOW = Date.parse('2026-11-17T09:00:00-06:00');   // a Tuesday; "last month" is October 2026
