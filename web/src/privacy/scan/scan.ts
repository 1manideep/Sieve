// The ingest-time scan and its cache (11 section 6, 01 section 11.1). The plain-code validators and patterns and the
// privacy model (Rampart) run once per item, in 20's background queue, and are cached on the record with versions.
// Gemini Nano does not run here (11 P3, Nov 20): its PII and injection checks run at share time on the text that
// would leave (steps/shareCheck.ts), and the record's stamp says they are pending.
import type { CategoryRule, IndexRecord, InjectionFinding, KnownEntity, PiiSpan, PiiStage, ScanStageStamp, TraceStep } from '@sieve/shared';
import { SCAN_MEMO_SIZE, STAGE_VERSIONS } from '../constants';
import { scanTextHash } from '../hash';
import { checkInjectionDetailed } from '../injection/check';
import { patternsVersion } from '../injection/patterns';
import { getPrivacyModelStatus } from '../model/client';
import { detectPiiInternal, runPiiStage } from '../pii/detect';
import { prepareValidators } from '../pii/validators';
import type { ExpectedStages, NanoPendingStage, PrivacyScanStampWithPending, ScanNowOptions, ScanOptions, ScanPatch, ScanTaskOptions } from '../types';

const PII_STAGES: readonly PiiStage[] = ['validators', 'model', 'nano'];
const PII_BY: Record<PiiStage, PiiSpan['by']> = { validators: 'validator', model: 'model', nano: 'nano' };
const STAGE_OF_BY: Record<PiiSpan['by'], PiiStage> = { validator: 'validators', model: 'model', nano: 'nano' };
const PII_VERSION: Record<PiiStage, string> = { validators: STAGE_VERSIONS.validators, model: STAGE_VERSIONS.model, nano: STAGE_VERSIONS.nanoPii };

/** What the privacy checks read: the text, or the caption for photos. */
export function scanText(record: Pick<IndexRecord, 'text' | 'caption'>): string {
  return record.text ?? record.caption ?? '';
}

/** The display name of "Name <address>", or the whole value when there is no "<". */
export function senderName(from: string | undefined): string {
  if (!from) return '';
  const lt = from.indexOf('<');
  if (lt < 0) return from.trim();
  return from.slice(0, lt).trim().replace(/^"(.*)"$/, '$1').trim();
}

export function headerText(record: Pick<IndexRecord, 'from' | 'title'>): string {
  return [senderName(record.from), record.title].filter(Boolean).join('\n');
}

export function recordTextHash(record: Pick<IndexRecord, 'text' | 'caption' | 'hiddenRemoved'>): string {
  return scanTextHash(scanText(record), record.hiddenRemoved);
}

/** Seed records of the Playground are sample data; everything else is the person's own. */
export function defaultDataClass(record: Pick<IndexRecord, 'source'>): 'own' | 'sample' {
  return record.source === 'playground' ? 'sample' : 'own';
}

/**
 * Which stages should have run on this record on this device (6.2): plain code always, the privacy model unless the
 * rule is `never` (no model reads those items). Gemini Nano is never expected here, for own or sample data: its checks
 * run at share time on the outgoing text (10.7). `readyModelOnly` (share time): the browser model counts only when it
 * is ready now, since share time never waits for it. Async for the contract's shape (01 section 11.1).
 */
export async function expectedStages(record: IndexRecord, data: 'own' | 'sample', rule: CategoryRule, opts: { allowNano?: boolean; readyModelOnly?: boolean } = {}): Promise<ExpectedStages> {
  void record;
  void data;
  const out: ExpectedStages = { pii: ['validators'], injection: ['code'] };
  if (rule === 'never') return out;
  const model = getPrivacyModelStatus().state;
  if (model === 'ready' || (model !== 'failed' && !opts.readyModelOnly)) out.pii.push('model');
  return out;
}

function stampCurrent(stamp: ScanStageStamp | undefined, version: string): boolean {
  return stamp !== undefined && stamp.version === version;
}

export function isScanCurrent(record: IndexRecord, expected: ExpectedStages): boolean {
  const scan = record.privacyScan;
  if (!scan || scan.textHash !== recordTextHash(record)) return false;
  for (const stage of expected.pii) if (!stampCurrent(scan.pii[stage], PII_VERSION[stage])) return false;
  for (const stage of expected.injection) {
    const version = stage === 'code' ? patternsVersion() : STAGE_VERSIONS.nanoInjection;
    if (!stampCurrent(scan.injection[stage], version)) return false;
  }
  return true;
}

/** Strings already known to be personal details in this record: its spans (deduplicated) and its header entities. */
export function knownEntities(record: IndexRecord): KnownEntity[] {
  const text = scanText(record);
  const out: KnownEntity[] = [];
  const seen = new Set<string>();
  const add = (e: KnownEntity) => {
    const key = `${e.type}\u0000${e.text}`;
    if (!e.text.trim() || seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  for (const s of record.pii) {
    if (s.start < 0 || s.end > text.length || s.end <= s.start) continue;
    const e: KnownEntity = { text: text.slice(s.start, s.end), type: s.type, by: s.by };
    if (s.score !== undefined) e.score = s.score;
    add(e);
  }
  for (const e of record.privacyScan?.headerEntities ?? []) add(e);
  return out;
}

function stamp(version: string, ran: ScanStageStamp['ran'], ms: number): ScanStageStamp {
  return { version, ran, ms: Math.max(0, Math.round(ms)), at: Date.now() };
}

/**
 * The scan (6.1): re-runs only the expected stages whose stamp is not current; keeps the spans of the others (a Nano
 * stamp from before Nov 20 stays while it is current). No Gemini Nano call: `nanoPending` says those checks are left
 * for share time.
 */
export async function scanCore(record: IndexRecord, data: 'own' | 'sample', opts: ScanOptions): Promise<{ patch: ScanPatch; trace: TraceStep[] }> {
  await prepareValidators();
  const expected = await expectedStages(record, data, opts.rule);
  const text = scanText(record);
  const textHash = recordTextHash(record);
  const prev = record.privacyScan && record.privacyScan.textHash === textHash ? record.privacyScan : undefined;
  const priority = opts.priority ?? 'background';
  const waitForModel = opts.waitForModel ?? true;
  const trace: TraceStep[] = [];

  // PII, stage by stage; record.pii keeps the stage lists unmerged, each span tagged with its stage's `by`
  const piiStamps: Partial<Record<PiiStage, ScanStageStamp>> = {};
  let pii: PiiSpan[] = [];
  const kept = new Set<PiiStage>();
  const rerun: PiiStage[] = [];
  for (const stage of PII_STAGES) {
    const s = prev?.pii[stage];
    if (s && stampCurrent(s, PII_VERSION[stage])) {
      piiStamps[stage] = s;
      kept.add(stage);
      pii.push(...record.pii.filter((x) => x.by === PII_BY[stage]));
    } else if (expected.pii.includes(stage)) {
      rerun.push(stage);
    }
  }
  for (const stage of rerun) {
    const prior = pii.filter((x) => x.by !== PII_BY[stage]);
    const res = await runPiiStage(stage, text, { data, prior, recordIds: [record.id], signal: opts.signal, priority, waitForModel });
    trace.push(res.trace);
    if (res.ran) piiStamps[stage] = stamp(PII_VERSION[stage], res.where, res.ms);
    pii = [...prior, ...res.spans.map((x) => ({ ...x, by: PII_BY[stage] }))];
  }

  // header: personal details in the sender name and the subject
  let headerEntities: KnownEntity[] = (prev?.headerEntities ?? []).filter((e) => kept.has(STAGE_OF_BY[e.by]));
  const header = headerText(record);
  if (rerun.length > 0 && header) {
    const res = await detectPiiInternal(header, data, { stages: rerun, recordIds: [record.id], signal: opts.signal, allowNano: false }, { waitForModel, priority });
    const seen = new Set(headerEntities.map((e) => `${e.type}\u0000${e.text}`));
    for (const s of res.spans) {
      const e: KnownEntity = { text: header.slice(s.start, s.end), type: s.type, by: s.by };
      if (s.score !== undefined) e.score = s.score;
      const key = `${e.type}\u0000${e.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        headerEntities.push(e);
      }
    }
  } else if (!header) {
    headerEntities = [];
  }

  // injection: the text and the hidden fragments (text hidden from people is the likeliest place for one)
  const injStamps: Partial<Record<'code' | 'nano', ScanStageStamp>> = {};
  const codeCurrent = stampCurrent(prev?.injection.code, patternsVersion());
  const nanoCurrent = stampCurrent(prev?.injection.nano, STAGE_VERSIONS.nanoInjection);
  if (codeCurrent && prev?.injection.code) injStamps.code = prev.injection.code;
  if (nanoCurrent && prev?.injection.nano) injStamps.nano = prev.injection.nano;
  let injection: InjectionFinding = record.injection ?? { suspicious: false, by: 'code' };
  if (!codeCurrent) {
    const detail = await checkInjectionDetailed(text, data, { model: false, extraText: record.hiddenRemoved, recordIds: [record.id], signal: opts.signal });
    trace.push(detail.trace);
    injStamps.code = stamp(patternsVersion(), 'code', detail.codeMs);
    const cachedNanoFlag = nanoCurrent && record.injection?.by === 'nano' && record.injection.suspicious;
    injection = cachedNanoFlag && record.injection ? record.injection : detail.finding;
  }

  // Gemini Nano's checks wait for share time, where they read only the text that would leave (10.7). Items under a
  // `never` rule are never shared, so nothing is pending for them.
  const nanoPending: NanoPendingStage[] = opts.rule === 'never' ? [] : [...(piiStamps.nano ? [] : ['pii' as const]), ...(injStamps.nano ? [] : ['injection' as const])];
  const privacyScan: PrivacyScanStampWithPending = { textHash, pii: piiStamps, injection: injStamps, headerEntities };
  if (nanoPending.length > 0) privacyScan.nanoPending = nanoPending;
  return { patch: { pii, injection, privacyScan }, trace };
}

/** 01 section 11.1: the task handler 20's queue runs (data class in opts, default from the record's source). */
export function scanRecord(record: IndexRecord, opts: ScanTaskOptions): Promise<ScanPatch>;
/** 11 section 6.1: the same scan, with the data class first and the trace returned. */
export function scanRecord(record: IndexRecord, data: 'own' | 'sample', opts: ScanOptions): Promise<{ patch: ScanPatch; trace: TraceStep[] }>;
export async function scanRecord(record: IndexRecord, a: 'own' | 'sample' | ScanTaskOptions, b?: ScanOptions): Promise<ScanPatch | { patch: ScanPatch; trace: TraceStep[] }> {
  if (typeof a === 'string') return scanCore(record, a, b ?? { rule: 'approve' });
  return (await scanCore(record, a.data ?? defaultDataClass(record), a)).patch;
}

// ---------------------------------------------------------------- in-memory scans (share time)

const memo = new Map<string, Promise<{ patch: ScanPatch; trace: TraceStep[] }>>();

/** One scan per record text, shared by parallel callers; an LRU of SCAN_MEMO_SIZE (10.2 step 1). */
export function memoScan(record: IndexRecord, data: 'own' | 'sample', opts: ScanOptions): Promise<{ patch: ScanPatch; trace: TraceStep[] }> {
  const key = [record.id, record.version, recordTextHash(record), data, opts.rule].join('\u0000');
  const hit = memo.get(key);
  if (hit) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const p = scanCore(record, data, opts);
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  while (memo.size > SCAN_MEMO_SIZE) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
  return p;
}

export function clearScanMemo(): void {
  memo.clear();
}

/**
 * The foreground scan (01 section 11.1): when the record is stale, scans it now (never waiting for the browser model)
 * and returns it with the new pii, injection and privacyScan; `save` persists the patch first. A current record is
 * returned as is.
 */
export async function scanNow(record: IndexRecord, opts: ScanNowOptions): Promise<IndexRecord> {
  const data = opts.data ?? defaultDataClass(record);
  const waitForModel = opts.waitForModel ?? false;
  const expected = await expectedStages(record, data, opts.rule, { allowNano: opts.allowNano, readyModelOnly: !waitForModel });
  if (isScanCurrent(record, expected)) return record;
  const { patch } = await memoScan(record, data, { ...opts, priority: opts.priority ?? 'foreground', waitForModel });
  if (opts.save) await opts.save(patch, record.version);
  return { ...record, ...patch };
}
