// Typed access to Chrome's Prompt API global (10 section 7.1). Every device module goes through getLanguageModel(),
// never the global, so unit tests can replace it. The types below are the subset Sieve uses (Chrome Prompt API docs,
// updated 2026-10-21), declared here so the build needs no extra type package.

export interface LMExpected {
  type: 'text' | 'image' | 'audio';
  languages?: readonly string[];
}
export interface LMCoreOptions {
  expectedInputs?: readonly LMExpected[];
  expectedOutputs?: readonly LMExpected[];
}
export interface LMDownloadProgressEvent {
  loaded: number;
}
export interface LMMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: LMDownloadProgressEvent) => void): void;
}
export type LMContentPart = { type: 'text'; value: string } | { type: 'image'; value: Blob };
export interface LMMessage {
  role: 'system' | 'user';
  content: string | LMContentPart[];
}
export interface LMCreateOptions extends LMCoreOptions {
  signal?: AbortSignal;
  monitor?: (m: LMMonitor) => void;
  initialPrompts?: LMMessage[];
}
export interface LMPromptOptions {
  signal?: AbortSignal;
  responseConstraint?: object;
}
export interface LanguageModelSession {
  prompt(input: string | LMMessage[], options?: LMPromptOptions): Promise<string>;
  promptStreaming(input: string | LMMessage[], options?: LMPromptOptions): ReadableStream<string>;
  clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
}
export interface LanguageModelStatic {
  availability(options?: LMCoreOptions): Promise<string>;
  create(options?: LMCreateOptions): Promise<LanguageModelSession>;
}

let override: { value: LanguageModelStatic | undefined } | null = null;

function isLanguageModel(v: unknown): v is LanguageModelStatic {
  if ((typeof v !== 'object' && typeof v !== 'function') || v === null) return false;
  const lm = v as Partial<LanguageModelStatic>;
  return typeof lm.availability === 'function' && typeof lm.create === 'function';
}

/** globalThis.LanguageModel when it has availability() and create(); undefined otherwise. */
export function getLanguageModel(): LanguageModelStatic | undefined {
  if (override) return override.value;
  const g = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  return isLanguageModel(g) ? g : undefined;
}

/** Test seam: a fake (or undefined for "no Prompt API"); null restores the real global. */
export function setLanguageModelForTests(fake: LanguageModelStatic | undefined | null): void {
  override = fake === null ? null : { value: fake };
}
