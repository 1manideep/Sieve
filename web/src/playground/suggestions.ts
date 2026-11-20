// The Playground's suggested questions (40 section 13.9), in this order. The first five always show; `mytest` appears
// once a test email is added and `upload` once a file is added (most recent file only). Ids and texts match
// data/playground/questions.json, whose expected items the index tests check.
import { PLAYGROUND_SUGGESTION_COPY, fill } from '@/copy/screens-main';

export type SuggestionId = 'landlord' | 'hotdog' | 'bank' | 'health' | 'parcel' | 'mytest' | 'upload';

export interface Suggestion {
  id: SuggestionId;
  text: string;
}

export const BASE_SUGGESTIONS: readonly Suggestion[] = [
  { id: 'landlord', text: PLAYGROUND_SUGGESTION_COPY.landlord },
  { id: 'hotdog', text: PLAYGROUND_SUGGESTION_COPY.hotdog },
  { id: 'bank', text: PLAYGROUND_SUGGESTION_COPY.bank },
  { id: 'health', text: PLAYGROUND_SUGGESTION_COPY.health },
  { id: 'parcel', text: PLAYGROUND_SUGGESTION_COPY.parcel },
];

export const MY_TEST_SUGGESTION: Suggestion = { id: 'mytest', text: PLAYGROUND_SUGGESTION_COPY.mytest };

/** "move-out-notes.txt" gives "move-out-notes"; a name without an extension stays as it is. */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** "What does {file name without extension} say?" */
export function uploadQuestion(fileName: string): string {
  return fill(PLAYGROUND_SUGGESTION_COPY.upload, { name: stripExtension(fileName) });
}

export interface SuggestionContext {
  hasTestEmail: boolean;
  latestFileName?: string;     // the most recent file the visitor added
}

export function playgroundSuggestions(ctx: SuggestionContext): Suggestion[] {
  const list = [...BASE_SUGGESTIONS];
  if (ctx.hasTestEmail) list.push(MY_TEST_SUGGESTION);
  if (ctx.latestFileName) list.push({ id: 'upload', text: uploadQuestion(ctx.latestFileName) });
  return list;
}
