// Every threshold and cap of the privacy pipeline (docs/spec/11-privacy-pipeline.md section 2.2).

// sanitize
export const SANITIZE_MAX_HTML_CHARS = 2_000_000;     // longer HTML is cut before parsing
export const SANITIZE_MAX_TEXT_CHARS = 200_000;       // longer clean text is cut, with CUT_NOTE appended
export const CUT_NOTE = '\n[cut: this item is very long]';
export const QUOTED_NOTE = '[quoted text not included]';
export const HIDDEN_FRAGMENT_MAX_CHARS = 500;
export const HIDDEN_FRAGMENTS_MAX = 50;
export const MIN_VISIBLE_FONT_PX = 6;                 // smaller text counts as hidden
export const MIN_VISIBLE_OPACITY = 0.1;               // effective opacity below this is hidden
export const MIN_VISIBLE_CONTRAST = 1.3;              // WCAG contrast ratio below this is hidden
export const OFFSCREEN_PX = 500;                      // offsets at or beyond -500px are off screen
export const TINY_BOX_PX = 1;                         // height/width at or below 1px with overflow hidden
export const DESKTOP_WIDTH_PX = 1280;                 // reference width for @media (min-width) rules

// browser model
export const MODEL_DIR = 'rampart-b1993e4';           // folder under /models/, also the transformers.js model id
export const MODEL_REVISION = 'b1993e4e68b082835b80ffc65acc03325ea2e501';
export const MODEL_MIN_SCORE = 0.4;                   // Rampart's calibrated recall-biased floor
export const MODEL_LOAD_TIMEOUT_MS = 180_000;
export const MODEL_DETECT_TIMEOUT_MS = 15_000;
export const MODEL_PROBE_TEXT = 'Please call Maria Garcia at the office.';

// Nano
export const NANO_PII_TIMEOUT_MS = 20_000;
export const NANO_INJECTION_TIMEOUT_MS = 15_000;
export const NANO_CHUNK_CHARS = 12_000;               // max characters of item text per Nano call
export const NANO_PII_MAX_ITEMS = 40;

// steps
export const ANSWER_MAX_CHARS = 300;                  // 00 decision D5 (11 section 2.2 said 600; D5 overrides)
export const ANSWER_MAX_VERBATIM_WORDS = 12;          // longest run of words the answer may copy from the item
export const EXCERPT_MAX_CHARS = 1_200;
export const HIDDEN_LEAK_MIN_CHARS = 12;              // shorter hidden fragments are not leak-checked
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_MAX_BYTES = 600_000;
export const INJECTION_QUOTE_MAX_CHARS = 200;
export const WARNING_QUOTE_MAX_CHARS = 140;
export const SCAN_MEMO_SIZE = 16;                     // in-memory scans kept for share time (10.2 step 1)
export const QUOTE_OVERLAP_MIN = 0.6;                 // 8.2 step 4 and 10.4 step 5

// outgoing text tokens and notes
export const REMOVED_SENTENCE = '[removed: a sentence that looked like an instruction to an AI]';
export const FULL_CUT_NOTE = '\n[The rest of this item was cut: it is longer than Sieve sends at once.]';
export const PHOTO_ATTACHED_NOTE = '[Image attached. Location and camera details were removed.]';

// cache versions: bump one when the matching code or prompt changes; that stage re-runs
export const STAGE_VERSIONS = {
  validators: 'validators@1',
  model: 'rampart@b1993e4+minscore0.4',
  nanoPii: 'nano-pii@1',
  patterns: 'patterns@1',
  nanoInjection: 'nano-injection@1',
} as const;

// 10 CR-5: prompt versions as numbers (the same versions as the stage stamps above)
export const PII_PROMPT_VERSION = 1;
export const INJECTION_PROMPT_VERSION = 1;
