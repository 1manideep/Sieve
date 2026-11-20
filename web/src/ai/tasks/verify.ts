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
  signal?: AbortSignal;
  ownCloud?: OwnCloudPolicy;
  today?: number;
}

const FIELD_CHARS = 140;

/** The user message for the verify call. */
export function verifyPrompt(question: string, record: IndexRecord, passage: string, answer: string, today: number): string {
  const lines = [`Today is ${localDay(today)}.`, `Question: ${promptField(question, 600)}`, `Proposed answer: ${promptField(answer, 400)}`, '', 'Item', `Kind: ${record.kind}`];
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
    prompt: verifyPrompt(question, record, passage, answer, today),
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
