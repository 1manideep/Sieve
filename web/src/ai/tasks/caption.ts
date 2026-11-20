// captionPhoto (10 section 10.4): one sentence describing a photo, for the private search index. Background for
// enrichment; foreground for the Playground's "Caption live" button.
import type { DataClass } from '@sieve/shared';
import { CAPTION_MAX_CHARS } from '../config';
import { CAPTION_CLOUD_SCHEMA, CAPTION_SCHEMA, CAPTION_SYSTEM, CAPTION_USER } from '../prompts';
import { runModel } from '../runModel';
import { cleanModelSentence } from '../text';
import type { OwnCloudPolicy, Priority, RunModelResult } from '../types';

export { CAPTION_SYSTEM } from '../prompts';
export { toJpegPart } from '../image';

export async function captionPhoto(
  blob: Blob,
  data: DataClass,
  opts?: { recordId?: string; ownCloud?: OwnCloudPolicy; signal?: AbortSignal; priority?: Priority },
): Promise<RunModelResult<{ caption: string }>> {
  const res = await runModel<{ caption: string }>({
    purpose: 'caption',
    mode: data === 'own' ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE',
    data,
    system: CAPTION_SYSTEM,
    schema: CAPTION_SCHEMA,
    cloudSchema: CAPTION_CLOUD_SCHEMA,
    prompt: [
      { type: 'text', text: CAPTION_USER },
      { type: 'image', blob },
    ],
    recordIds: opts?.recordId ? [opts.recordId] : [],   // without a record id an own photo can never reach the cloud
    ownCloud: opts?.ownCloud,
    signal: opts?.signal,
    priority: opts?.priority ?? 'background',
    dataChars: 0,                                         // runModel adds the image's base64 length: what leaves the device
    validate: (v) => {
      const caption = cleanModelSentence(String((v as { caption?: unknown }).caption ?? ''), CAPTION_MAX_CHARS);
      return caption ? { caption } : null;
    },
  });
  if (!res.ok) return res;
  const kb = Math.max(1, Math.round(((res.trace.charsSent ?? 0) * 3) / 4 / 1024));
  const label =
    res.trace.where === 'device'
      ? 'Described this photo on this device'
      : `Described this photo in the cloud: the photo (${kb} KB) left this device`;
  return { ...res, trace: { ...res.trace, label } };
}
