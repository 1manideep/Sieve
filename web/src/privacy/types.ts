// Module types (11 section 2.3), with 10's allowNano (01 section 11.4) and 01 section 11.1's task-handler shape.
import type {
  CategoryRule,
  InjectionFinding,
  KnownEntity,
  LadderStep,
  PiiSpan,
  PiiStage,
  PiiType,
  PrivacyScanStamp,
  SharedImage,
} from '@sieve/shared';

export type { KnownEntity, PiiStage, PrivacyScanStamp, ScanStageStamp, SharedImage } from '@sieve/shared';

export interface SanitizeOptions {
  keepQuoted?: boolean;              // default false: quoted reply history is removed (section 4.8)
}

export interface DetectPiiOptions {
  stages?: PiiStage[];               // default all three
  known?: KnownEntity[];             // strings already known to be personal details; located in `text`
  recordIds?: string[];              // passed to runModel
  signal?: AbortSignal;
  allowNano?: boolean;               // default true; the pipeline passes false at question time (10 CR-5)
}

export interface RedactOptions {
  keepTypes?: PiiType[];             // spans of these types are left in place (answer-step exemption only)
}

export interface CheckInjectionOptions {
  model?: boolean;                   // default true: run the Nano advisory when available
  extraText?: string[];              // e.g. hidden fragments; checked by code and shown to Nano after the text
  recordIds?: string[];
  signal?: AbortSignal;
  allowNano?: boolean;               // false behaves like model: false
}

export interface ScanPatch { pii: PiiSpan[]; injection: InjectionFinding; privacyScan: PrivacyScanStamp }

export interface BuildStepOptions {
  maxStep?: LadderStep;              // default 'full'
  question?: string;                 // enables the answer-step exemptions (section 10.3)
  photo?: Blob;                      // the original photo; required for a photo's full step
  rule?: CategoryRule;               // used only if buildStepOption must scan the record itself; default 'approve'
  signal?: AbortSignal;
  onScanned?: (patch: ScanPatch) => void;  // called when buildStepOption had to scan the record itself
  allowNano?: boolean;               // default true; the pipeline passes false at question time (10 CR-5)
}

/** Options of a scan. Background scans wait for the browser model; share-time scans never do (5.4.5). */
export interface ScanOptions {
  rule: CategoryRule;
  signal?: AbortSignal;
  allowNano?: boolean;               // default true
  priority?: 'foreground' | 'background';   // default 'background'
  waitForModel?: boolean;            // default true for scanRecord, false for scanNow and buildStepOption
}

/** 01 section 11.1: scanRecord(record, opts) as a task handler; the data class rides in opts. */
export interface ScanTaskOptions extends ScanOptions {
  data?: 'own' | 'sample';           // default: 'sample' for Playground seed records, else 'own'
}

export interface ScanNowOptions extends ScanTaskOptions {
  /** Persists the patch (for example 20's patchRecord with the version read); awaited before scanNow resolves. */
  save?: (patch: ScanPatch, loadedVersion: number) => Promise<unknown>;
}

export interface ExpectedStages { pii: PiiStage[]; injection: ('code' | 'nano')[] }

export type PrivacyModelState = 'idle' | 'loading' | 'ready' | 'failed';
export interface PrivacyModelStatus {
  state: PrivacyModelState;
  device?: 'webgpu' | 'wasm';
  progress?: number;                 // 0..1 while downloading
  loadMs?: number;
  error?: string;
}

export interface PatternMatch { id: string; weight: 1 | 2; sentence: string; start: number; end: number }
export interface PatternReport { score: number; suspicious: boolean; matches: PatternMatch[]; quote?: string }
export interface ExtraPattern { id: string; source: string; flags?: string; weight: 1 | 2 }

export type PreparedPhoto = { ok: true; image: SharedImage; removed: string[] } | { ok: false; reason: string };
