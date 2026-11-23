// readAsYesNo: a yes or no question whose answer came as a sentence gets one small call that reads the sentence as
// yes, no or unclear (10 section 12.3). Own data stays on the device, as with the check of the answer.
import type { DataClass } from '@sieve/shared';
import { YES_NO_CLOUD_SCHEMA, YES_NO_SCHEMA, YES_NO_SYSTEM } from '../prompts';
import { runModel } from '../runModel';
import { promptField } from '../text';
import type { OwnCloudPolicy, RunModelResult } from '../types';

export type YesNo = 'yes' | 'no' | 'unclear';

export function yesNoPrompt(question: string, sentence: string): string {
  return `Question: ${promptField(question, 600)}\nSentence: ${promptField(sentence, 400)}`;
}

export async function readAsYesNo(
  question: string,
  sentence: string,
  data: DataClass,
  opts: { signal?: AbortSignal; ownCloud?: OwnCloudPolicy } = {},
): Promise<RunModelResult<YesNo>> {
  return runModel<YesNo>({
    purpose: 'yes-no',
    mode: data === 'own' ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE',
    data,
    system: YES_NO_SYSTEM,
    schema: YES_NO_SCHEMA,
    cloudSchema: YES_NO_CLOUD_SCHEMA,
    prompt: yesNoPrompt(question, sentence),
    recordIds: [],
    ownCloud: opts.ownCloud,
    signal: opts.signal,
    priority: 'foreground',
    dataChars: question.length + sentence.length,
    validate: (v) => {
      const answer = (v as { answer?: unknown } | null)?.answer;
      return answer === 'yes' || answer === 'no' || answer === 'unclear' ? answer : null;
    },
  });
}
