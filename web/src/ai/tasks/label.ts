// labelBatch (10 section 10.2): one category per item, in batches, for the background queue only (never at question
// time). It always resolves with a label for every item: plain code fills in whatever the model did not give.
import { CATEGORIES, NANO_PROMPT_BUDGET } from '@sieve/shared';
import type { Category, DataClass, IndexRecord, TraceStep, Where } from '@sieve/shared';
import { estimatePromptTokens } from '../budget';
import { LABEL_BATCH_SIZE, LABEL_FROM_CHARS, LABEL_PREVIEW_CHARS, LABEL_TITLE_CHARS } from '../config';
import { LABEL_CLOUD_SCHEMA, LABEL_SCHEMA, LABEL_SYSTEM } from '../prompts';
import { runModel } from '../runModel';
import { promptField } from '../text';
import { codeTrace } from '../trace';
import type { Priority } from '../types';
import { codeLabel, isHealthStrong, isPetCare } from './codeLabel';

export { CODE_LABEL_RULES, HEALTH_STRONG, codeLabel, isHealthStrong } from './codeLabel';
export { LABEL_CLOUD_SCHEMA, LABEL_SCHEMA, LABEL_SYSTEM } from '../prompts';

export type LabelItem = Pick<IndexRecord, 'id' | 'title' | 'from' | 'preview' | 'kind'>;
export interface LabelBatchResult {
  labels: Record<string, Category>;
  trace: TraceStep;
  by?: Record<string, Where>;                       // 'device' | 'cloud' | 'code' per item
  confidence?: Record<string, 'high' | 'low'>;
  sdk?: 'on_device' | 'in_cloud';                   // what the SDK reported (absent when no model ran)
}

const CATEGORY_SET = new Set<string>(CATEGORIES);
const STOP_CODES = new Set(['unavailable', 'downloading', 'needs-consent', 'cloud-not-allowed', 'aborted']);

/** One item block of the user message (10 section 10.2). */
function itemBlock(item: LabelItem, n: number): { text: string; chars: number } {
  const lines = [`Item ${n}`, `Kind: ${item.kind}`];
  let chars = 0;
  const add = (label: string, value: string) => {
    lines.push(`${label}: ${value}`);
    chars += value.length;
  };
  if (item.from) add('From', promptField(item.from, LABEL_FROM_CHARS));
  const titleLabel = item.kind === 'document' || item.kind === 'photo' ? 'File' : 'Subject';
  add(titleLabel, promptField(item.title, LABEL_TITLE_CHARS));
  add(item.kind === 'photo' ? 'Description' : 'Preview', promptField(item.preview, LABEL_PREVIEW_CHARS));
  return { text: lines.join('\n'), chars };
}

/** The user message for one chunk, and the characters of the person's content in it. */
export function labelPrompt(items: LabelItem[]): { text: string; dataChars: number } {
  const blocks = items.map((item, i) => itemBlock(item, i + 1));
  const header = `Label these ${items.length} items. Reply as {"labels":[{"i":1,"c":"Home"}]} with exactly one entry per item.`;
  return { text: [header, ...blocks.map((b) => b.text)].join('\n\n'), dataChars: blocks.reduce((n, b) => n + b.chars, 0) };
}

/** Keeps entries with an integer i in 1..n (first wins) and c in CATEGORIES; null when fewer than half are valid. */
export function parseLabels(n: number): (value: unknown) => Map<number, Category> | null {
  return (value) => {
    if (typeof value !== 'object' || value === null) return null;
    const list = (value as { labels?: unknown }).labels;
    if (!Array.isArray(list)) return null;
    const out = new Map<number, Category>();
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { i, c } = entry as { i?: unknown; c?: unknown };
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 1 || i > n || out.has(i)) continue;
      if (typeof c !== 'string' || !CATEGORY_SET.has(c)) continue;
      out.set(i, c as Category);
    }
    return out.size >= Math.ceil(n / 2) ? out : null;
  };
}

function fitsBudget(items: LabelItem[]): boolean {
  return estimatePromptTokens({ system: LABEL_SYSTEM, texts: [labelPrompt(items).text], images: 0, schema: LABEL_SCHEMA }) <= NANO_PROMPT_BUDGET;
}

/** Splits into chunks of `size`; a chunk over the prompt budget is halved until it fits. */
function chunksOf(items: LabelItem[], size: number): LabelItem[][] {
  const out: LabelItem[][] = [];
  const queue: LabelItem[][] = [];
  for (let i = 0; i < items.length; i += size) queue.push(items.slice(i, i + size));
  while (queue.length) {
    const chunk = queue.shift() as LabelItem[];
    if (chunk.length > 1 && !fitsBudget(chunk)) {
      const half = Math.ceil(chunk.length / 2);
      queue.unshift(chunk.slice(0, half), chunk.slice(half));
      continue;
    }
    out.push(chunk);
  }
  return out;
}

export async function labelBatch(
  items: LabelItem[],
  data: DataClass,
  opts?: { signal?: AbortSignal; priority?: Priority; batchSize?: number },
): Promise<LabelBatchResult> {
  if (items.length === 0) return { labels: {}, trace: codeTrace('label', 'Nothing to label', 0) };
  if (data === 'approved') throw new Error('labelBatch never takes approved text');
  const at = Date.now();

  const labels: Record<string, Category> = {};
  const by: Record<string, Where> = {};
  const confidence: Record<string, 'high' | 'low'> = {};
  const fromCode = (item: LabelItem) => {
    labels[item.id] = codeLabel(item).category;
    by[item.id] = 'code';
  };

  const toModel: LabelItem[] = [];
  for (const item of items) {
    if (item.kind === 'photo' && !item.preview?.trim()) {
      labels[item.id] = 'Photos';
      by[item.id] = 'code';
      confidence[item.id] = 'high';
    } else {
      toModel.push(item);
    }
  }

  let ms = 0;
  let charsSent = 0;
  let ranDevice: TraceStep | undefined;
  let ranCloud: TraceStep | undefined;
  let stop = false;
  for (const chunk of chunksOf(toModel, opts?.batchSize ?? LABEL_BATCH_SIZE)) {
    if (stop) {
      chunk.forEach(fromCode);
      continue;
    }
    const prompt = labelPrompt(chunk);
    const res = await runModel<Map<number, Category>>({
      purpose: 'label',
      mode: data === 'own' ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE',
      data,
      system: LABEL_SYSTEM,
      schema: LABEL_SCHEMA,
      cloudSchema: LABEL_CLOUD_SCHEMA,
      prompt: prompt.text,
      priority: opts?.priority ?? 'background',
      signal: opts?.signal,
      dataChars: prompt.dataChars,
      skipSchemaCheck: true,                 // one bad entry must not discard the batch (10.2 step 6)
      validate: parseLabels(chunk.length),
    });
    ms += res.trace.ms;
    charsSent += res.trace.charsSent ?? 0;
    if (res.trace.sdkReported === 'on_device') ranDevice = res.trace;
    if (res.trace.sdkReported === 'in_cloud') ranCloud = res.trace;
    if (!res.ok) {
      chunk.forEach(fromCode);
      if (STOP_CODES.has(res.error.code)) stop = true;
      continue;
    }
    const where: Where = res.trace.where;
    chunk.forEach((item, i) => {
      const c = res.value.get(i + 1);
      if (c) {
        labels[item.id] = c;
        by[item.id] = where;
      } else {
        fromCode(item);
      }
    });
  }

  // Post-rules, then confidence (10 section 10.2 steps 8 and 9).
  for (const item of toModel) {
    const code = codeLabel(item);
    let label = labels[item.id];
    let changed = false;
    if (item.kind !== 'photo' && label === 'Photos') {
      label = 'Personal';
      changed = true;
    }
    if (isHealthStrong(item) && label !== 'Health') {
      label = 'Health';
      changed = true;
    }
    if (changed) {
      by[item.id] = 'code';
      confidence[item.id] = 'low';
    } else if (by[item.id] === 'code') {
      confidence[item.id] = 'low';
    } else if (label === code.category || !code.matched) {
      confidence[item.id] = 'high';
    } else {
      // The model and plain code disagree. Measured on 225 labelled emails (Nov 21, 2026): in these cases the model
      // was right 21% of the time and plain code 74%, so plain code's category is kept, marked low. An item the
      // model filed under Health stays there: Health is never shared, and that rule fails closed. The one exception
      // is mail about a pet (isPetCare), which is not the person's health.
      if (label !== 'Health' || isPetCare(item)) label = code.category;
      confidence[item.id] = 'low';
    }
    labels[item.id] = label;
  }

  // One step for the whole call: cloud when any chunk ran in the cloud, device when the model ran only here.
  const n = items.length;
  const ran = ranCloud ?? ranDevice;
  const label = ranCloud
    ? `Sorted ${n} sample items in the cloud`
    : ranDevice
      ? `Sorted ${n} items on this device`
      : `Sorted ${n} items with plain code (no model)`;
  const trace: TraceStep = ran
    ? {
        kind: 'label',
        label,
        where: ran.where,
        modeRequested: ran.modeRequested,
        sdkReported: ran.sdkReported,
        model: ran.model,
        ms,
        charsSent,
        at,
      }
    : codeTrace('label', label, ms, at, charsSent || undefined);
  return { labels, trace, by, confidence, ...(ran?.sdkReported ? { sdk: ran.sdkReported } : {}) };
}
