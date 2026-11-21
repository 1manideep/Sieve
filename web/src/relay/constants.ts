// Timing constants for the home base (40 section 11.9), with the page-to-extension timings of 50 section 6.5
// and the contract's 20 s keepalive (01 section 6), which win over 40's 25 s and 1 s first retry.
import { RELAY_DECISION_MINUTES } from '@sieve/shared';

export const PREPARE_TIMEOUT_MS = 120_000;             // abort prepareProposal for a relay request
export const ASK_TIMEOUT_MS = 120_000;                 // abort prepareProposal for an in-app question
export const CLAIM_RETRY_MS = [2_000, 5_000, 10_000];  // offline claim (and other transition) retries
export const AUTO_FLOOR_MS = 3_000;                    // 11.6: an automatic outcome leaves no sooner than this after arrival
export const AUTO_JITTER_MS = 1_000;                   // plus up to this much random jitter
export const EXTENSION_ACK_MS = 2_000;                 // wait for sieve/hello-ack
export const EXTENSION_KEEPALIVE_MS = 20_000;          // resend sieve/pending while connected (01 section 6)
export const EXTENSION_BACKOFF_MS = [0, 2_000, 5_000, 10_000, 30_000];   // reconnect after a drop (50 section 6.5)
export const EXTENSION_BACKOFF_AFTER_MS = 60_000;      // then every 60 s
export const EXTENSION_PROBE_MS = 60_000;              // retry when not installed (also on window focus)
export const DONE_ENTRY_TTL_MS = 600_000;              // remove done entries from the screen
export const AVAILABILITY_POLL_MS = 60_000;            // model status (3000 while downloading; state/availability.ts)
export const AUDIT_RECHECK_MS = 300_000;               // log check on /seen
export const DECISION_WINDOW_MS = RELAY_DECISION_MINUTES * 60_000;   // rules: home base writes within 120 min of createdAt
export const WAKE_TICK_MS = 15_000;                    // 70 section 3.5: clock-jump detector tick
export const WAKE_GAP_MS = 90_000;                     // a gap above this between ticks is a sleep or freeze
export const WAKE_MERGE_MS = 2_000;                    // wakes within this are one wake
export const MAX_PREVIEWS = 20;                        // 01 section 6: at most 20 proposals in sieve/pending
export const MAX_PENDING_MESSAGE_CHARS = 500_000;      // under the extension's 512 KiB message limit (50 section 6.6)
