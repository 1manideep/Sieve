// Access to the AI layer (10) and the privacy pipeline (11) without pulling firebase/ai into the index bundle
// (40 section 17): ingest uses only pure modules (the code labeller, prompt versions, the sanitizer); the queue
// loads the `@/ai` and `@/privacy` barrels with import() when it first needs a model.
import { codeLabel, codeRelabel, isHealthStrong } from '@/ai/tasks/codeLabel';
import { PROMPT_VERSIONS } from '@/ai/versions';
import { looksLikeHtmlDocument as htmlDocument } from '@/privacy/sanitize/htmlText';
import { sanitizeIncoming as sanitize } from '@/privacy/sanitize/sanitize';
import type {
  Category, CategoryRule, DataClass, IndexRecord, InjectionFinding, NanoAvailability, PiiSpan, PiiStage, PrivacyScanStamp, TraceStep, Where,
} from '@sieve/shared';

export type Priority = 'foreground' | 'background';

export interface LabelBatchResult {
  labels: Record<string, Category>;
  trace: TraceStep;
  by?: Record<string, Where>;
  confidence?: Record<string, 'high' | 'low'>;
  sdk?: 'on_device' | 'in_cloud';
}
type LabelItem = Pick<IndexRecord, 'id' | 'title' | 'from' | 'preview' | 'kind'>;
type LabelBatchFn = (items: LabelItem[], data: DataClass, opts?: { signal?: AbortSignal; priority?: Priority; batchSize?: number }) => Promise<LabelBatchResult>;
type CaptionResult = { ok: true; value: { caption: string }; trace: TraceStep } | { ok: false; error: { code: string; message: string }; trace: TraceStep };
type CaptionFn = (blob: Blob, data: DataClass, opts?: { recordId?: string; signal?: AbortSignal; priority?: Priority }) => Promise<CaptionResult>;

export interface NanoStateLike { text: NanoAvailability; image: NanoAvailability }

/** The parts of the `@/ai` barrel the queue uses, typed as 10 section 10 gives them. */
interface AiBarrel {
  labelBatch: LabelBatchFn;
  captionPhoto: CaptionFn;
  getNanoAvailability(): Promise<NanoStateLike>;
  subscribeNano(fn: (s: unknown) => void): () => void;
}

let aiBarrel: Promise<AiBarrel> | null = null;
function loadAi(): Promise<AiBarrel> {
  aiBarrel ??= import('@/ai').then((m) => m as unknown as AiBarrel);
  return aiBarrel;
}

export const aiApi = {
  codeLabel: (item: Pick<IndexRecord, 'title' | 'from' | 'preview' | 'kind' | 'bulk'>) => codeLabel(item),
  codeRelabel: (rec: IndexRecord) => codeRelabel(rec),
  isHealthStrong: (item: Pick<IndexRecord, 'title' | 'from' | 'preview'>) => isHealthStrong(item),
  promptVersions(): { label: number; caption: number } {
    return { label: PROMPT_VERSIONS.label, caption: PROMPT_VERSIONS.caption };
  },
  async labelBatch(items: LabelItem[], data: DataClass, opts?: { signal?: AbortSignal; priority?: Priority }): Promise<LabelBatchResult> {
    return (await loadAi()).labelBatch(items, data, opts);
  },
  async captionPhoto(blob: Blob, data: DataClass, opts?: { recordId?: string; signal?: AbortSignal; priority?: Priority }): Promise<CaptionResult> {
    return (await loadAi()).captionPhoto(blob, data, opts);
  },
  async nano(): Promise<NanoStateLike> {
    try {
      return await (await loadAi()).getNanoAvailability();
    } catch {
      return { text: 'unavailable', image: 'unavailable' };
    }
  },
  subscribeNano(fn: () => void): () => void {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void loadAi()
      .then((ai) => {
        if (!cancelled) unsub = ai.subscribeNano(() => fn());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsub?.();
    };
  },
};

export interface ScanPatch { pii: PiiSpan[]; injection: InjectionFinding; privacyScan: PrivacyScanStamp }
export interface ExpectedStages { pii: PiiStage[]; injection: ('code' | 'nano')[] }
export interface PrivacyScanApi {
  scanRecord(record: IndexRecord, data: 'own' | 'sample', opts: { rule: CategoryRule; signal?: AbortSignal }): Promise<{ patch: ScanPatch; trace: TraceStep[] }>;
  expectedStages(record: IndexRecord, data: 'own' | 'sample', rule: CategoryRule): Promise<ExpectedStages>;
  isScanCurrent(record: IndexRecord, expected: ExpectedStages): boolean;
  // 11's privacy model status (optional for stand-ins): the privacy lane waits while it loads instead of holding the loop
  getPrivacyModelStatus?(): { state: 'idle' | 'loading' | 'ready' | 'failed' };
  warmupPrivacyModel?(): Promise<unknown>;
  onPrivacyModelStatus?(cb: (s: { state: string }) => void): () => void;
}

let privacyApi: PrivacyScanApi | null = null;
let privacyLoading: Promise<PrivacyScanApi | null> | null = null;

/** Loads 11's scan functions once (they import the AI layer, so they are not in the first load). */
export function loadPrivacyScanApi(): Promise<PrivacyScanApi | null> {
  privacyLoading ??= import('@/privacy')
    .then((ns) => {
      // Read each function once, defensively: a stand-in module may lack the optional model-status ones (and a test
      // mock throws when a missing export is read).
      const pick = <K extends keyof PrivacyScanApi>(k: K): PrivacyScanApi[K] | undefined => {
        try {
          const f = (ns as unknown as Partial<PrivacyScanApi>)[k];
          return typeof f === 'function' ? f : undefined;
        } catch {
          return undefined;
        }
      };
      const scanRecord = pick('scanRecord');
      const expectedStages = pick('expectedStages');
      const isScanCurrent = pick('isScanCurrent');
      privacyApi = scanRecord && expectedStages && isScanCurrent
        ? {
          scanRecord, expectedStages, isScanCurrent,
          getPrivacyModelStatus: pick('getPrivacyModelStatus'), warmupPrivacyModel: pick('warmupPrivacyModel'), onPrivacyModelStatus: pick('onPrivacyModelStatus'),
        }
        : null;
      return privacyApi;
    })
    .catch(() => null);
  return privacyLoading;
}

/** 11's scan functions once loaded (the queue calls loadPrivacyScanApi when it starts), else null. */
export function privacyScanApi(): PrivacyScanApi | null {
  return privacyApi;
}

export function sanitizeIncoming(raw: { html?: string; text?: string }): { text: string; hiddenRemoved: string[] } {
  return sanitize(raw);
}

/** A stored body that is an HTML document kept as plain text (see the sanitizer). */
export function looksLikeHtmlDocument(text: string): boolean {
  return htmlDocument(text);
}
