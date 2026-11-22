// Types of the AI layer (10 section 9.1; contract in 01 section 9).
import type { DataClass, InferenceModeName, TraceKind, TraceStep } from '@sieve/shared';
import type { SieveDb } from '@/index';

export type { DataClass } from '@sieve/shared';

export type PromptPart = { type: 'text'; text: string } | { type: 'image'; blob: Blob };
export type Purpose = 'label' | 'select-answer' | 'verify-answer' | 'search-words' | 'caption' | 'draft' | 'injection-check' | 'pii-check';
export type Priority = 'foreground' | 'background';

/** Who may let own data reach the cloud, and where consent rows live (10 section 8). */
export interface OwnCloudPolicy {
  allowed: boolean;          // real data: settings.cloudFallbackForOwnData; Playground: true (per-file consent is the switch)
  db: SieveDb;               // where the consents store lives
  maxAgeMs: number | null;   // real data: CONSENT_MAX_AGE_MS; Playground: null (valid until Reset)
}

export interface RunModelArgs {
  purpose: Purpose;
  mode: InferenceModeName;
  data: DataClass;
  prompt: string | PromptPart[];          // one single-turn prompt
  system?: string;
  schema?: object;                        // JSON schema for structured output
  recordIds?: string[];                   // checked against per-file cloud consent
  signal?: AbortSignal;
  timeoutMs?: number;
  // owner additions (10 section 9.1, 01 section 11.4)
  cloudSchema?: object;                   // schema with propertyOrdering for the cloud; defaults to schema
  priority?: Priority;                    // default DEFAULT_PRIORITY[purpose]
  ownCloud?: OwnCloudPolicy;              // absent: own data is device-only
  dataChars?: number;                     // characters of the person's content in the prompt; default: all prompt text
  validate?: (value: unknown, attempt: number) => unknown; // semantic check after the schema check; null means invalid, any other value replaces it; attempt is 1 or 2
  /** The line added to the prompt for the one retry after an invalid reply; the format reminder when not given. */
  retryReminder?: () => string;
  skipSchemaCheck?: boolean;              // JSON is still parsed, but only `validate` judges it (labels keep the valid entries)
  onText?: (soFar: string) => void;       // set: stream the response
  label?: string;                         // trace label on success
  traceKind?: TraceKind;                  // default per purpose (10 section 9.7)
}

export type ModelErrorCode =
  | 'unavailable' | 'downloading' | 'needs-consent' | 'cloud-not-allowed' | 'too-long' | 'bad-output'
  | 'timeout' | 'aborted' | 'app-check' | 'quota' | 'unknown';

export interface ModelError {
  code: ModelErrorCode;
  message: string;
  detail?: string;                        // development builds only; may quote content, never sent anywhere
}

export type RunModelResult<T> =
  | { ok: true; value: T; trace: TraceStep }
  | { ok: false; error: ModelError; trace: TraceStep };
