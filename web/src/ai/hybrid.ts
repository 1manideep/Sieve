// Every Firebase AI Logic model call (10 section 6). With init.ts, the only runtime importer of 'firebase/ai'.
// Each call is GenerativeModel.generateContent or generateContentStream on a hybrid model whose on-device side is
// Sieve's own adapter, so the SDK routes the call and reports where it ran (response.inferenceSource).
import {
  GenerativeModel,
  InferenceMode,
  ThinkingLevel,
  type GenerationConfig,
  type ModelParams,
  type Part,
  type SchemaRequest,
} from 'firebase/ai';
import type { DataClass, InferenceModeName } from '@sieve/shared';
import { MAX_OUTPUT_TOKENS } from './config';
import { SieveDeviceAdapter } from './device/adapter';
import { getAiInstance } from './init';
import { fnv1a, sessionKeyFor } from './keys';
import type { Priority, Purpose } from './types';

export interface ModelSpec {
  purpose: Purpose;
  mode: InferenceModeName;                 // the effective mode chosen by policy (10 section 8)
  system?: string;
  schema?: object;                         // plain JSON schema (device form, no propertyOrdering)
  cloudSchema?: object;                    // same schema plus propertyOrdering, for the cloud
  image: boolean;                          // the prompt contains an image
  cloudModel: string;
}
export type SdkPart = { text: string } | { inlineData: { mimeType: 'image/jpeg' | 'image/png'; data: string } };
export interface ModelCallResult {
  text: string;
  source: 'on_device' | 'in_cloud';
}
/** What runModel knows about a call; the real caller ignores it, fakes record it. */
export interface CallMeta {
  data: DataClass;
  recordIds: string[];
  priority: Priority;
}
export interface CallOptions {
  signal: AbortSignal;
  timeoutMs: number;
  meta?: CallMeta;
}
export interface HybridCaller {
  generate(spec: ModelSpec, parts: SdkPart[], opts: CallOptions): Promise<ModelCallResult>;
  stream(spec: ModelSpec, parts: SdkPart[], opts: CallOptions & { onText: (soFar: string) => void }): Promise<ModelCallResult>;
}

const MODEL_CACHE_MAX = 32;
const cache = new Map<string, GenerativeModel>();

export function modelCacheKey(spec: ModelSpec): string {
  return `${spec.mode}|${spec.purpose}|${spec.image}|${spec.cloudModel}|${fnv1a(spec.system ?? '')}|${fnv1a(JSON.stringify(spec.schema ?? null))}`;
}

function buildModel(spec: ModelSpec): GenerativeModel {
  const generationConfig: GenerationConfig = {
    maxOutputTokens: MAX_OUTPUT_TOKENS[spec.purpose],
    thinkingConfig: { thinkingLevel: spec.purpose === 'draft' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL },
    ...(spec.schema ? { responseMimeType: 'application/json', responseSchema: (spec.cloudSchema ?? spec.schema) as SchemaRequest } : {}),
  };
  const inCloudParams: ModelParams = { model: spec.cloudModel, systemInstruction: spec.system, generationConfig };
  if (spec.mode === 'ONLY_IN_CLOUD') return new GenerativeModel(getAiInstance(), inCloudParams);   // no adapter: cloud only
  const adapter = new SieveDeviceAdapter({
    mode: InferenceMode[spec.mode],
    sessionKey: sessionKeyFor(spec.purpose, spec.image, spec.system),
    system: spec.system,
    image: spec.image,
    schema: spec.schema,
    quietSchema: spec.purpose === 'injection-check',
    bindToScheduler: spec.mode !== 'PREFER_IN_CLOUD',
  });
  return new GenerativeModel(getAiInstance(), inCloudParams, undefined, adapter);
}

/** A cached GenerativeModel for the spec (the config of a GenerativeModel is fixed for its life). */
export function modelFor(spec: ModelSpec): GenerativeModel {
  const key = modelCacheKey(spec);
  let model = cache.get(key);
  if (!model) {
    if (cache.size >= MODEL_CACHE_MAX) cache.clear();
    model = buildModel(spec);
    cache.set(key, model);
  }
  return model;
}

/** One user message. Parts carry the SDK's `type` tag, which the SDK strips before the cloud request. */
function request(parts: SdkPart[]): { contents: { role: 'user'; parts: Part[] }[] } {
  const typed = parts.map((p): Part => ('text' in p ? { type: 'text', text: p.text } : { type: 'inlineData', inlineData: p.inlineData }));
  return { contents: [{ role: 'user', parts: typed }] };
}

const realHybrid: HybridCaller = {
  async generate(spec, parts, opts) {
    const res = await modelFor(spec).generateContent(request(parts), { signal: opts.signal, timeout: opts.timeoutMs });
    return { text: res.response.text(), source: res.response.inferenceSource ?? 'in_cloud' };
  },
  async stream(spec, parts, opts) {
    const { stream, response } = await modelFor(spec).generateContentStream(request(parts), { signal: opts.signal, timeout: opts.timeoutMs });
    let soFar = '';
    for await (const chunk of stream) {
      soFar += chunk.text();
      opts.onText(soFar);
    }
    const final = await response;
    return { text: final.text(), source: final.inferenceSource ?? 'in_cloud' };
  },
};

let override: HybridCaller | null = null;

export function getHybrid(): HybridCaller {
  return override ?? realHybrid;
}

/** Unit tests (10 section 15) and the e2e seam replace the SDK caller. null restores it. */
export function setHybridForTests(fake: HybridCaller | null): void {
  override = fake;
}

export function clearModelCache(): void {
  cache.clear();
}
