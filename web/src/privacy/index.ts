// The privacy pipeline (docs/spec/11-privacy-pipeline.md): public exports. Nothing else is imported from outside
// this folder. Everything here runs on the device; the only outbound call is runModel (web/src/ai) with purpose
// pii-check or injection-check.
import { clearScanMemo } from './scan/scan';
import { forgetPendingDetections } from './model/client';

// Contract functions (01 section 9), each with the optional last parameter of 11 CR1 (01 section 11.4)
export { sanitizeIncoming } from './sanitize/sanitize';
export { detectPii } from './pii/detect';
export { redact } from './redact';
export { checkInjection } from './injection/check';
export { buildStepOption } from './steps/build';

// Ingest-time scan and cache (11 section 6; 01 section 11.1: scanRecord is a task handler for 20's queue)
export { scanRecord, scanNow, isScanCurrent, expectedStages, knownEntities, scanText } from './scan/scan';

// Browser PII model (11 section 5.4), hosted by 20's ML worker as the 'pii' task (model/pii.task.ts)
export { warmupPrivacyModel, getPrivacyModelStatus, onPrivacyModelStatus, setPrivacyModelHost } from './model/client';
export type { PiiModelHost, PiiModelRunOptions } from './model/client';

// Injection patterns (11 section 8)
export { matchInjectionPatterns, setExtraInjectionPatterns } from './injection/patterns';
export { INJECTION_CHECK_SYSTEM } from './injection/nano';
export { PII_CHECK_SYSTEM } from './pii/nano';
export { PII_CHECK_SCHEMA, INJECTION_CHECK_SCHEMA } from './schemas';

// Share-time helpers (11 sections 10 and 11)
export { preparePhotoForShare } from './steps/photo';
export { privacyWarnings } from './warnings';
export { privacyTraceFor } from './trace';
export { verifyOutgoing, OutgoingMismatchError } from './steps/invariants';

export { STAGE_VERSIONS, PII_PROMPT_VERSION, INJECTION_PROMPT_VERSION } from './constants';

export type {
  SanitizeOptions,
  DetectPiiOptions,
  RedactOptions,
  CheckInjectionOptions,
  ScanPatch,
  BuildStepOptions,
  ScanOptions,
  ScanTaskOptions,
  ScanNowOptions,
  ExpectedStages,
  PrivacyModelState,
  PrivacyModelStatus,
  PatternMatch,
  PatternReport,
  ExtraPattern,
  PreparedPhoto,
  KnownEntity,
  PiiStage,
  PrivacyScanStamp,
  ScanStageStamp,
  SharedImage,
} from './types';

/** Empties the in-memory scan cache and drops detections still in flight (sign-out, Playground Reset). */
export function clearPrivacyCaches(): void {
  clearScanMemo();
  forgetPendingDetections();
}
