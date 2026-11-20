// Environment and every constant of the AI layer (10 sections 4.2 and 4.3). The only file that reads AI env variables.
import type { Priority, Purpose } from './types';

export const CLOUD_MODEL_DRAFT = import.meta.env.VITE_CLOUD_MODEL_DRAFT || 'gemini-3.8-flash';
export const CLOUD_MODEL_FALLBACK = import.meta.env.VITE_CLOUD_MODEL_FALLBACK || 'gemini-3.5-flash-lite';
export const DEVICE_MODEL_NAME = 'gemini-nano';              // TraceStep.model for on-device runs

/** App Check settings, read by init.ts. */
export function appCheckEnv(): { siteKey: string; debugToken: string; production: boolean } {
  return {
    siteKey: (import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY ?? '').trim(),
    debugToken: (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN ?? '').trim(),
    production: import.meta.env.PROD === true,
  };
}

export const CHARS_PER_TOKEN = 3;                            // conservative estimate (Gemini docs say about 4 for English)
export const IMAGE_TOKENS_ESTIMATE = 1500;                   // per image; the spike may lower it
export const RETRY_RESERVE_TOKENS = 60;                      // room for the retry reminder
export const SELECT_TARGET_TOKENS = 2500;                    // soft target for the question-time prompt (latency)
export const SELECT_MAX_PASSAGES = 7;                        // VECTOR_K + KEYWORD_SAFETY_K
export const PASSAGE_CONTEXT_CHARS = 300;                    // extra sentences around a chunk, each side, when the budget allows
export const PASSAGE_MAX_CHARS = 1600;
export const PASSAGE_MIN_CHARS = 400;
export const PASSAGE_WINDOW_CHARS = 1000;                    // bestWindow size when no vector chunk is known (10.3)
export const PASSAGE_SNAP_CHARS = 200;                       // how far a core may move to reach a sentence boundary
export const ANSWER_MAX_CHARS = 300;
export const EXCERPT_MAX_CHARS = 600;
export const CAPTION_MAX_CHARS = 200;
export const DRAFT_MAX_CHARS = 2000;
export const DRAFT_INSTRUCTION_MAX_CHARS = 200;
export const CLOUD_PROMPT_MAX_CHARS = 60000;

export const LABEL_BATCH_SIZE = 10;                          // measured 6 to 9 s per 10
export const LABEL_RETRY_BATCH_SIZE = 5;                     // low-confidence re-runs
export const LABEL_FROM_CHARS = 80;
export const LABEL_TITLE_CHARS = 140;
export const LABEL_PREVIEW_CHARS = 160;

export const IMAGE_MAX_EDGE_PX = 1024;
export const IMAGE_JPEG_QUALITY = 0.85;

export const AVAILABILITY_MAX_AGE_MS = 5000;
export const CONSENT_MAX_AGE_MS = 10 * 60 * 1000;            // real data: a consent covers the request that asked for it
export const BACKGROUND_RESUME_DELAY_MS = 1500;              // background waits this long after the last foreground call
export const MAX_BASE_SESSIONS = 6;
export const SAMPLE_QUOTA_RETRY_MS = 2000;                   // 70 R-PLAT-16: one retry for sample-data select on quota

/** Delays that unit tests may shorten. Production code reads them from here, never the constants directly. */
export const TIMING = {
  backgroundResumeDelayMs: BACKGROUND_RESUME_DELAY_MS,
  sampleQuotaRetryMs: SAMPLE_QUOTA_RETRY_MS,
};

export const TIMEOUT_MS: Record<Purpose, number> = {
  'select-answer': 45000, label: 60000, caption: 60000, draft: 30000, 'injection-check': 30000, 'pii-check': 30000,
};
export const MAX_OUTPUT_TOKENS: Record<Purpose, number> = {
  'select-answer': 256, label: 1200, caption: 128, draft: 600, 'injection-check': 256, 'pii-check': 1024,
};
export const DEFAULT_PRIORITY: Record<Purpose, Priority> = {
  'select-answer': 'foreground', draft: 'foreground', caption: 'background', label: 'background',
  'injection-check': 'background', 'pii-check': 'background',
};

export const TEXT_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
} as const;
export const IMAGE_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
} as const;
