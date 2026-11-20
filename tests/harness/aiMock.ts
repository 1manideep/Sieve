// A stand-in for web/src/ai (10) in index and source tests: the code labeller and Health safety net with 10's
// published rules (10 section 10.2), plus controllable labelBatch, captionPhoto and Nano availability.
// Use: vi.mock('@/ai', async () => (await import('<path>/tests/harness/aiMock')).aiModule)
import type { Category, DataClass, IndexRecord, NanoAvailability, TraceStep, Where } from '@sieve/shared';

export const HEALTH_STRONG: RegExp[] = [
  /\b(doctor|physician|patient|clinic|medical|hospital|pharmacy|prescriptions?)\b|\bdr\.\s/i,
  /\b(test results?|lab results?|lab services|blood (draw|test|work)|biopsy|diagnos\w*|vaccin\w*|immuni[sz]ation)\b/i,
  /\b(dental|dentist|orthodont\w*|therap(y|ist)|counsel(l)?ing|behavioral health|mental health|psychiatr\w*)\b/i,
  /\b(health plan|health insurance|explanation of benefits|care team|patient portal)\b/i,
];

const CODE_LABEL_RULES: [Category, RegExp[]][] = [
  ['Health', HEALTH_STRONG],
  ['Money', [/\b(bank|statement|credit card|card services|debit|payment|paid|payroll|w-2|1099|tax(es)?|tax return|invest\w*|portfolio|loan|mortgage|wire transfer|transfer|credit union|refund)\b/i]],
  ['Travel', [/\b(flight|airline|air|boarding|check in now|booking reference|hotel|inn|reservation|rental car|car rental|itinerary|trip|passport|visa)\b/i]],
  ['Home', [/\b(rent|landlord|lease|apartment|unit \d+\w?|property management|maintenance request|electricity|power|water bill|gas bill|utility|utilities|package room|concierge|move-out|move-in|inspection)\b/i]],
  ['Work', [/\b(meeting|agenda|q[1-4] planning|interview|recruit\w*|offer letter|pr #?\d+|code review|pull request|timesheet|hr operations|slides|customer demo|standup|1:1)\b/i]],
  ['Newsletters', [/\b(newsletter|digest|weekly|webinar|podcast|episode|deals?|sale|% off|black friday|promo\w*|product update|what's new|unsubscribe)\b/i]],
  ['Shopping', [/\b(order|shipped|shipping|delivered|return label|receipt|pickup order|tracking)\b/i]],
  ['Personal', [/\b(mom|dad|birthday|wedding|invitation|party|saturday|sunday|photos from|pictures)\b/i]],
];

type Item = Pick<IndexRecord, 'id' | 'title' | 'from' | 'preview' | 'kind'>;

export function codeLabel(item: Pick<IndexRecord, 'title' | 'from' | 'preview' | 'kind'>): { category: Category; matched: boolean } {
  if (item.kind === 'photo') return { category: 'Photos', matched: true };
  const hay = `${item.from ?? ''}\n${item.title}\n${item.preview}`;
  for (const [cat, res] of CODE_LABEL_RULES) if (res.some((r) => r.test(hay))) return { category: cat, matched: true };
  return { category: 'Personal', matched: false };
}

export function isHealthStrong(item: Pick<IndexRecord, 'title' | 'from' | 'preview'>): boolean {
  return HEALTH_STRONG.some((r) => r.test(`${item.from ?? ''}\n${item.title}\n${item.preview}`));
}

function trace(kind: TraceStep['kind'], where: Where, ms = 0): TraceStep {
  return { kind, label: kind, where, ms, at: Date.now() };
}

export interface LabelCall { ids: string[]; data: DataClass; priority?: string }
export const aiControl = {
  nano: { text: 'available' as NanoAvailability, image: 'available' as NanoAvailability },
  labelCalls: [] as LabelCall[],
  captionCalls: [] as { recordId?: string; data: DataClass }[],
  /** Default: the model answers with the code label, on the device. */
  labelImpl: null as null | ((items: Item[], data: DataClass) => Promise<{ labels: Record<string, Category>; by?: Record<string, Where>; trace: TraceStep }>),
  captionImpl: null as null | ((blob: Blob, data: DataClass, recordId?: string) => Promise<{ ok: true; value: { caption: string }; trace: TraceStep } | { ok: false; error: { code: string; message: string }; trace: TraceStep }>),
  listeners: new Set<(s: unknown) => void>(),
  reset() {
    this.nano = { text: 'available', image: 'available' };
    this.labelCalls = [];
    this.captionCalls = [];
    this.labelImpl = null;
    this.captionImpl = null;
  },
  setNano(text: NanoAvailability, image: NanoAvailability = text) {
    this.nano = { text, image };
    for (const fn of this.listeners) fn({ text, image });
  },
};

export const aiModule = {
  codeLabel,
  isHealthStrong,
  PROMPT_VERSIONS: { label: 1, caption: 1, select: 1, draft: 1 },
  async getNanoAvailability() {
    return { ...aiControl.nano };
  },
  subscribeNano(fn: (s: unknown) => void) {
    aiControl.listeners.add(fn);
    return () => aiControl.listeners.delete(fn);
  },
  async labelBatch(items: Item[], data: DataClass, opts?: { priority?: string; signal?: AbortSignal }) {
    aiControl.labelCalls.push({ ids: items.map((i) => i.id), data, priority: opts?.priority });
    if (aiControl.labelImpl) return aiControl.labelImpl(items, data);
    const labels: Record<string, Category> = {};
    const by: Record<string, Where> = {};
    for (const it of items) {
      labels[it.id] = codeLabel(it).category;
      by[it.id] = 'device';
    }
    return { labels, by, trace: trace('label', 'device', 8 * items.length), sdk: 'on_device' as const };
  },
  async captionPhoto(blob: Blob, data: DataClass, opts?: { recordId?: string }) {
    aiControl.captionCalls.push({ recordId: opts?.recordId, data });
    if (aiControl.captionImpl) return aiControl.captionImpl(blob, data, opts?.recordId);
    return { ok: true as const, value: { caption: 'A photo described on this device.' }, trace: { ...trace('caption', 'device', 10), sdkReported: 'on_device' as const } };
  },
};
