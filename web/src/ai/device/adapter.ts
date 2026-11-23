// Sieve's own ChromeAdapter (10 section 7.5, decisions A2 and A3). Passed to the public GenerativeModel constructor,
// so Firebase AI Logic still routes every call and reports inferenceSource, while Sieve adds warm sessions,
// AbortSignal and streaming. Firebase AI Logic's built-in adapter makes a new session per call and cannot abort.
import type { ChromeAdapter, GenerateContentRequest } from 'firebase/ai';
import { cloneFromBase } from './sessions';
import { getNanoState } from './availability';
import type { LMContentPart, LMPromptOptions, LanguageModelSession } from './languageModel';
import { currentDeviceCall } from './scheduler';

export interface DeviceAdapterOptions {
  mode: 'only_on_device' | 'prefer_on_device' | 'prefer_in_cloud';
  sessionKey: string;
  system?: string;
  image: boolean;
  schema?: object;
  bindToScheduler: boolean;       // true: read the signal from currentDeviceCall(); false: run unbound (draft fallback)
  /**
   * Keep Chrome's own line about the schema ("Remember to respond in JSON that follows this JSON Schema ...") out of
   * the model's input. The check for text aimed at an AI read that line as part of the text it was checking and
   * flagged clean one-sentence texts 9 times in 70; without it 3 in 70, and it caught more real ones (Nov 23, 2026).
   */
  quietSchema?: boolean;
}

const DEVICE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const neverAborted = new AbortController().signal;

interface RequestPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

function partsOf(request: GenerateContentRequest): RequestPart[] {
  return request.contents.flatMap((c) => (c.parts ?? []) as RequestPart[]);
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function sse(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] })}\n\n`;
}

export class SieveDeviceAdapter implements ChromeAdapter {
  /** Read by the SDK's routing (an internal member of ChromeAdapter). */
  readonly mode: DeviceAdapterOptions['mode'];
  private readonly opts: DeviceAdapterOptions;

  constructor(opts: DeviceAdapterOptions) {
    this.opts = opts;
    this.mode = opts.mode;
  }

  /** Synchronous logic on the last known state (runModel refreshed it just before). Never waits for a download. */
  isAvailable(request: GenerateContentRequest): Promise<boolean> {
    const state = getNanoState();
    const parts = partsOf(request);
    const hasImage = parts.some((p) => p.inlineData);
    const need = hasImage ? state.image : state.text;
    if (need !== 'available' || state.simulated) return Promise.resolve(false);
    if (parts.some((p) => p.inlineData && !DEVICE_IMAGE_TYPES.has(p.inlineData.mimeType))) return Promise.resolve(false);
    return Promise.resolve(true);
  }

  private content(request: GenerateContentRequest): LMContentPart[] {
    const contents = request.contents;
    if (contents.length !== 1 || contents[0].role !== 'user') throw new Error('Sieve sends one user message per call');
    return (contents[0].parts as RequestPart[]).map((p): LMContentPart =>
      p.inlineData ? { type: 'image', value: base64ToBlob(p.inlineData.data, p.inlineData.mimeType) } : { type: 'text', value: p.text ?? '' },
    );
  }

  private signal(): AbortSignal {
    return this.opts.bindToScheduler ? (currentDeviceCall()?.signal ?? neverAborted) : neverAborted;
  }

  private session(signal: AbortSignal): Promise<LanguageModelSession> {
    return cloneFromBase({ key: this.opts.sessionKey, system: this.opts.system, image: this.opts.image }, signal);
  }

  private promptOptions(signal: AbortSignal): LMPromptOptions {
    if (!this.opts.schema) return { signal };
    return { signal, responseConstraint: this.opts.schema, ...(this.opts.quietSchema ? { omitResponseConstraintInput: true } : {}) };
  }

  async generateContent(request: GenerateContentRequest): Promise<Response> {
    const content = this.content(request);
    const signal = this.signal();
    const session = await this.session(signal);
    let text: string;
    try {
      text = await session.prompt([{ role: 'user', content }], this.promptOptions(signal));
    } finally {
      session.destroy();
    }
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async generateContentStream(request: GenerateContentRequest): Promise<Response> {
    const content = this.content(request);
    const signal = this.signal();
    const session = await this.session(signal);
    let reader: ReadableStreamDefaultReader<string>;
    try {
      reader = session.promptStreaming([{ role: 'user', content }], this.promptOptions(signal)).getReader();
    } catch (e) {
      session.destroy();
      throw e;
    }
    const encoder = new TextEncoder();
    let destroyed = false;
    const close = () => {
      if (destroyed) return;
      destroyed = true;
      session.destroy();
    };
    // Chrome streams deltas. If a build streams the whole text so far instead (10 V5), convert it to deltas.
    let emitted = '';
    let chunkIndex = 0;
    let cumulative = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            close();
            controller.close();
            return;
          }
          let delta = value;
          if (chunkIndex === 1 && emitted.length >= 4 && value.length > emitted.length && value.startsWith(emitted)) cumulative = true;
          if (cumulative) delta = value.startsWith(emitted) ? value.slice(emitted.length) : value;
          chunkIndex += 1;
          emitted += delta;
          if (delta) controller.enqueue(encoder.encode(sse(delta)));
        } catch (e) {
          close();
          controller.error(e);
        }
      },
      cancel(reason) {
        close();
        return reader.cancel(reason).catch(() => undefined);
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  }

  countTokens(): Promise<never> {
    return Promise.reject(new Error('countTokens is not used on device'));
  }
}
