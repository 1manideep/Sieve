// runModel(): the only way Sieve calls a model (10 section 9, decision A1). One place for policy, budget, scheduling,
// structured output, errors and the trace. Every call is one user message assembled by Sieve.
import type { InferenceModeName } from '@sieve/shared';
import { NANO_PROMPT_BUDGET } from '@sieve/shared';
import { estimatePromptTokens } from './budget';
import {
  CLOUD_MODEL_DRAFT,
  CLOUD_MODEL_FALLBACK,
  CLOUD_PROMPT_MAX_CHARS,
  DEFAULT_PRIORITY,
  TIMEOUT_MS,
} from './config';
import { getNanoAvailability } from './device/availability';
import { scheduleDevice, setDeviceTrySignal } from './device/scheduler';
import { getE2EHooks } from './e2e';
import { mapError } from './errors';
import { getHybrid, type ModelCallResult, type ModelSpec, type SdkPart } from './hybrid';
import { toJpegPart } from './image';
import { stripFences, validateJson } from './json';
import { hasFreshConsent, resolveRoute } from './policy';
import { RETRY_REMINDER } from './prompts';
import { assumedWhere, codeTrace, DEFAULT_TRACE_KIND, modelTrace, PURPOSE_NAME } from './trace';
import type { ModelError, Purpose, RunModelArgs, RunModelResult } from './types';

export { RETRY_REMINDER } from './prompts';

const breaches: { purpose: Purpose; at: number }[] = [];
const neverAborted = new AbortController().signal;

/** Breach-guard hits this session (expected: always empty). */
export function getPolicyBreaches(): { purpose: Purpose; at: number }[] {
  return [...breaches];
}

export function resetPolicyBreachesForTests(): void {
  breaches.length = 0;
}

function hasImage(prompt: RunModelArgs['prompt']): boolean {
  return typeof prompt !== 'string' && prompt.some((p) => p.type === 'image');
}

/** Resolves with `p`, or rejects at once when `signal` aborts (even if a lower layer ignores the signal). */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  p.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function withReminder(parts: SdkPart[]): SdkPart[] {
  const out = [...parts];
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const p = out[i];
    if ('text' in p) {
      out[i] = { text: `${p.text}\n\n${RETRY_REMINDER}` };
      return out;
    }
  }
  return [...out, { text: RETRY_REMINDER }];
}

type Parsed = { ok: true; value: unknown } | { ok: false };

function parse(text: string, args: RunModelArgs): Parsed {
  let value: unknown;
  if (!args.schema) {
    value = text.trim();
    if (value === '') return { ok: false };
  } else {
    try {
      value = JSON.parse(stripFences(text));
    } catch {
      return { ok: false };
    }
    if (!args.skipSchemaCheck && !validateJson(args.schema, value)) return { ok: false };
  }
  if (args.validate) {
    let checked: unknown;
    try {
      checked = args.validate(value);
    } catch {
      return { ok: false };
    }
    if (checked === null || checked === undefined) return { ok: false };
    value = checked;
  }
  return { ok: true, value };
}

function flatten(prompt: RunModelArgs['prompt']): string {
  return typeof prompt === 'string' ? prompt : prompt.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n');
}

export async function runModel<T>(args: RunModelArgs): Promise<RunModelResult<T>> {
  const at = Date.now();
  const kind = args.traceKind ?? DEFAULT_TRACE_KIND[args.purpose];
  const priority = args.priority ?? DEFAULT_PRIORITY[args.purpose];
  const name = PURPOSE_NAME[args.purpose];
  const stopped = (error: ModelError): RunModelResult<T> => ({
    ok: false,
    error,
    trace: codeTrace(kind, `Stopped before any model ran: ${error.message}`, 0, at, 0),
  });

  if (args.signal?.aborted) return stopped({ code: 'aborted', message: 'Stopped: the request was cancelled.' });

  const e2e = await getE2EHooks();
  let nano = await getNanoAvailability();
  const fault = e2e?.availabilityFault(args.purpose);
  if (fault) nano = { text: fault, image: fault };

  const image = hasImage(args.prompt);
  if (args.data === 'own' && args.mode !== 'ONLY_ON_DEVICE') {
    console.warn('Sieve: an own-data call asked for a cloud mode; the own-data policy applies.', args.purpose);
  }
  let consentOk = false;
  const needed = image ? nano.image : nano.text;
  if (args.data === 'own' && args.ownCloud?.allowed && needed !== 'available') {
    // Only the person's own records need consent. Ids are `${source}:${sourceRef}` (contracts section 10, invariant 1),
    // so Playground seeds mixed into the same prompt are recognised by their prefix.
    const ownIds = (args.recordIds ?? []).filter((id) => !id.startsWith('playground:'));
    consentOk = await hasFreshConsent(args.ownCloud, ownIds);
  }
  const route = resolveRoute({
    purpose: args.purpose,
    data: args.data,
    requestedMode: args.mode,
    image,
    nano,
    ownCloudAllowed: !!args.ownCloud?.allowed,
    consentOk,
  });
  if (!route.ok) return stopped({ code: route.code, message: route.message });
  const mode: InferenceModeName = route.mode;

  // Parts: a string prompt becomes one text part; images become JPEG parts (EXIF and GPS dropped).
  let parts: SdkPart[] = [];
  let imageCount = 0;
  let imageChars = 0;
  if (typeof args.prompt === 'string') {
    parts = [{ text: args.prompt }];
  } else {
    try {
      for (const p of args.prompt) {
        if (p.type === 'text') {
          parts.push({ text: p.text });
        } else {
          const jpeg = await toJpegPart(p.blob);
          parts.push({ inlineData: jpeg.inlineData });
          imageCount += 1;
          imageChars += jpeg.inlineData.data.length;
        }
      }
    } catch {
      return stopped({ code: 'unknown', message: 'This image could not be read.' });
    }
  }
  const texts = parts.flatMap((p) => ('text' in p ? [p.text] : []));
  const textChars = texts.reduce((n, t) => n + t.length, 0);

  // Budget (10 section 9.4).
  if (mode === 'ONLY_IN_CLOUD') {
    if (textChars + (args.system?.length ?? 0) > CLOUD_PROMPT_MAX_CHARS) {
      return stopped({ code: 'too-long', message: 'The prompt was too long for the cloud model.' });
    }
  } else if (estimatePromptTokens({ system: args.system, texts, images: imageCount, schema: args.schema }) > NANO_PROMPT_BUDGET) {
    return stopped({ code: 'too-long', message: 'The prompt was too long for the on-device model.' });
  }

  const cloudModel = args.purpose === 'draft' ? CLOUD_MODEL_DRAFT : CLOUD_MODEL_FALLBACK;
  const spec: ModelSpec = {
    purpose: args.purpose,
    mode,
    system: args.system,
    schema: args.schema,
    cloudSchema: args.cloudSchema ?? args.schema,
    image,
    cloudModel,
  };
  const dataChars = (args.dataChars ?? textChars + (args.system?.length ?? 0)) + imageChars;
  const timeoutMs = args.timeoutMs ?? TIMEOUT_MS[args.purpose];
  const maxTries = args.schema || args.validate ? 2 : 1;
  const meta = { data: args.data, recordIds: args.recordIds ?? [], priority };
  const hybrid = e2e?.hybrid ?? getHybrid();
  const scheduled = mode === 'ONLY_ON_DEVICE' || mode === 'PREFER_ON_DEVICE' || priority === 'background';

  const attempt = async (signal: AbortSignal): Promise<RunModelResult<T>> => {
    const t0 = performance.now();
    let cloudSends = 0;
    let source: ModelCallResult['source'] | undefined;
    let callParts = parts;
    let error: ModelError | undefined;
    let value: unknown;
    let done = false;
    for (let tries = 1; tries <= maxTries && !done; tries += 1) {
      const timer = new AbortController();
      const timeoutId = setTimeout(() => timer.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
      const callSignal = AbortSignal.any([signal, timer.signal]);
      if (scheduled) setDeviceTrySignal(callSignal);
      let result: ModelCallResult;
      try {
        const call = args.onText
          ? hybrid.stream(spec, callParts, { signal: callSignal, timeoutMs, meta, onText: args.onText })
          : hybrid.generate(spec, callParts, { signal: callSignal, timeoutMs, meta });
        result = await raceAbort(call, callSignal);
      } catch (e) {
        if (assumedWhere(mode) === 'cloud') cloudSends += 1;   // conservative: counted as sent
        const mapped = mapError(e, {
          mode,
          timedOut: timer.signal.aborted && !signal.aborted,
          callerAborted: args.signal?.aborted === true,
          timeoutMs,
        });
        if (mapped.code === 'bad-output' && tries < maxTries) {
          callParts = withReminder(parts);
          continue;
        }
        error = mapped;
        break;
      } finally {
        clearTimeout(timeoutId);
        if (scheduled) setDeviceTrySignal(null);
      }
      source = result.source;
      if (source === 'in_cloud') cloudSends += 1;
      if (mode === 'ONLY_ON_DEVICE' && source !== 'on_device') {
        console.error('Sieve policy breach: on-device-only call ran in the cloud', args.purpose);
        breaches.push({ purpose: args.purpose, at: Date.now() });
        error = { code: 'cloud-not-allowed', message: 'Sieve stopped: the SDK reported a cloud run for an on-device-only step.' };
        break;
      }
      const parsed = parse(result.text, args);
      if (parsed.ok) {
        value = parsed.value;
        done = true;
        break;
      }
      if (tries < maxTries) {
        callParts = withReminder(parts);
        continue;
      }
      error = { code: 'bad-output', message: 'The model gave no usable answer.' };
    }
    const ms = Math.round(performance.now() - t0);
    const where = source === 'on_device' ? 'on this device' : 'in the cloud';
    const label = done ? (args.label ?? `${name} ran ${where}`) : `${name} failed: ${error?.message ?? 'no answer'}`;
    const trace = modelTrace({
      kind, label, mode, source, assumedWhere: assumedWhere(mode), cloudModel, ms, dataChars, cloudSends, at,
    });
    if (done) return { ok: true, value: value as T, trace };
    return { ok: false, error: error ?? { code: 'unknown', message: 'Something went wrong with the model.' }, trace };
  };

  if (e2e) recordE2ECall(args, mode);
  try {
    return scheduled ? await scheduleDevice(priority, args.signal, attempt) : await attempt(args.signal ?? neverAborted);
  } catch (e) {
    // The scheduler rejects only when the caller aborted while the call was still queued.
    const mapped = mapError(e, { mode, timedOut: false, callerAborted: args.signal?.aborted === true, timeoutMs });
    return { ok: false, error: mapped, trace: codeTrace(kind, `${name} failed: ${mapped.message}`, 0, at, 0) };
  }
}

function recordE2ECall(args: RunModelArgs, mode: InferenceModeName): void {
  if (typeof window === 'undefined') return;
  const e2e = (window.__sieveE2E ??= {});
  (e2e.calls ??= []).push({ purpose: args.purpose, mode, data: args.data, recordIds: args.recordIds ?? [], prompt: flatten(args.prompt) });
}
