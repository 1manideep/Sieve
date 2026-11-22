// verifyAnswer (10 section 10.3a): one more on-device call after select-answer. Gemini Nano reads the chosen item's
// passage, its sender and date, the question and the proposed answer, and says whether the item really answers the
// question. Own data never leaves the device for it (ONLY_ON_DEVICE); sample data may use the cloud without Nano.
import type { DataClass, IndexRecord } from '@sieve/shared';
import { VERIFY_CLOUD_SCHEMA, VERIFY_SCHEMA, VERIFY_SYSTEM } from '../prompts';
import { runModel } from '../runModel';
import { localDay, promptField } from '../text';
import type { OwnCloudPolicy, RunModelResult } from '../types';
import { fitPassages, recordDay, type PassageRange } from './select';

export { VERIFY_CLOUD_SCHEMA, VERIFY_SCHEMA, VERIFY_SYSTEM } from '../prompts';

export interface VerifyValue {
  answers: boolean;
  reason: string;
}
export interface VerifyOptions {
  passage?: PassageRange;                // the range the select call read, offsets into recordBody(record)
  dates?: { after?: string; before?: string };   // the days the person means ('YYYY-MM-DD', inclusive), when they gave any
  signal?: AbortSignal;
  ownCloud?: OwnCloudPolicy;
  today?: number;
}

const FIELD_CHARS = 140;

/**
 * When the person gave days and this item fits them, the prompt says so. Left to work it out, the model compared the
 * question's day with other days in the answer and threw right answers away ("what did they remind me about on
 * November 4" answered with "late fees begin November 5"): measured on the on-device model, Nov 21, 2026. An item
 * outside the days gets no line, and the model judges as before.
 */
export function datesLine(record: IndexRecord, dates: VerifyOptions['dates']): string | null {
  if (!dates || (!dates.after && !dates.before)) return null;
  const inRange = (d: string) => (!dates.after || d >= dates.after) && (!dates.before || d <= dates.before);
  const own = recordDay(record);
  if (!inRange(own) && !(record.mentionedDays ?? []).some(inRange)) return null;
  const span =
    dates.after && dates.before ? (dates.after === dates.before ? `on ${dates.after}` : `from ${dates.after} to ${dates.before}`) : dates.after ? `from ${dates.after} on` : `up to ${dates.before}`;
  return `The person means an item dated ${span}. This item is dated ${own}, so its date fits: do not compare the question's date with other dates in the answer.`;
}

/** The user message for the verify call. */
export function verifyPrompt(question: string, record: IndexRecord, passage: string, answer: string, today: number, dates?: VerifyOptions['dates']): string {
  const fits = datesLine(record, dates);
  const lines = [`Today is ${localDay(today)}.`, `Question: ${promptField(question, 600)}`, ...(fits ? [fits] : []), `Proposed answer: ${promptField(answer, 400)}`, '', 'Item', `Kind: ${record.kind}`];
  if (record.from && record.kind !== 'photo') lines.push(`From: ${promptField(record.from, FIELD_CHARS)}`);
  lines.push(`Date: ${recordDay(record)}`, `Title: ${promptField(record.title, FIELD_CHARS)}`);
  lines.push(record.kind === 'photo' ? 'Description:' : 'Passage:', '<<<', passage, '>>>');
  return lines.join('\n');
}

export async function verifyAnswer(
  question: string,
  record: IndexRecord,
  answer: string,
  data: DataClass,
  opts: VerifyOptions = {},
): Promise<RunModelResult<VerifyValue>> {
  const today = opts.today ?? Date.now();
  const [p] = fitPassages(question, [record], opts.passage ? { [record.id]: opts.passage } : {}, { today });
  const passage = p?.text ?? '';
  return runModel<VerifyValue>({
    purpose: 'verify-answer',
    mode: data === 'own' ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE',
    data,
    system: VERIFY_SYSTEM,
    schema: VERIFY_SCHEMA,
    cloudSchema: VERIFY_CLOUD_SCHEMA,
    prompt: verifyPrompt(question, record, passage, answer, today, opts.dates),
    recordIds: [record.id],
    ownCloud: opts.ownCloud,
    signal: opts.signal,
    priority: 'foreground',
    dataChars: question.length + answer.length + passage.length + record.title.length + (record.from?.length ?? 0),
    validate: (v) => {
      const { answers, reason } = v as VerifyValue;
      return typeof answers === 'boolean' ? { answers, reason: typeof reason === 'string' ? reason : '' } : null;
    },
  });
}
