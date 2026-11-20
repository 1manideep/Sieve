// Trace steps (10 section 9.7, 00 decision 9): where a model call ran comes from what the SDK reported, never from
// an assumption, except when the call failed before the SDK answered.
import type { InferenceModeName, TraceKind, TraceStep, Where } from '@sieve/shared';
import { DEVICE_MODEL_NAME } from './config';
import type { Purpose } from './types';

export const DEFAULT_TRACE_KIND: Record<Purpose, TraceKind> = {
  label: 'label', 'select-answer': 'select', 'verify-answer': 'answer', caption: 'caption', draft: 'draft', 'injection-check': 'injection', 'pii-check': 'pii',
};

export const PURPOSE_NAME: Record<Purpose, string> = {
  label: 'Sorting',
  'select-answer': 'Reading and answering',
  'verify-answer': 'Checking the answer',
  caption: 'Describing the photo',
  draft: 'Drafting',
  'injection-check': 'The AI-instruction check',
  'pii-check': 'The personal details check',
};

/** Where a call is assumed to have run when it failed before the SDK reported (cloud modes count as sent). */
export function assumedWhere(mode: InferenceModeName): Where {
  return mode === 'ONLY_ON_DEVICE' || mode === 'PREFER_ON_DEVICE' ? 'device' : 'cloud';
}

export function modelTrace(p: {
  kind: TraceKind;
  label: string;
  mode: InferenceModeName;
  source: 'on_device' | 'in_cloud' | undefined;
  assumedWhere: Where;
  cloudModel: string;
  ms: number;
  dataChars: number;
  cloudSends: number;
  at: number;
}): TraceStep {
  const where: Where = p.source === 'on_device' ? 'device' : p.source === 'in_cloud' ? 'cloud' : p.assumedWhere;
  return {
    kind: p.kind,
    label: p.label,
    where,
    modeRequested: p.mode,
    ...(p.source ? { sdkReported: p.source } : {}),
    model: where === 'device' ? DEVICE_MODEL_NAME : p.cloudModel,
    ms: p.ms,
    charsSent: p.dataChars * p.cloudSends,
    at: p.at,
  };
}

export function codeTrace(kind: TraceKind, label: string, ms: number, at: number = Date.now(), charsSent?: number): TraceStep {
  return { kind, label, where: 'code', ms: Math.round(ms), at, ...(charsSent !== undefined ? { charsSent } : {}) };
}
