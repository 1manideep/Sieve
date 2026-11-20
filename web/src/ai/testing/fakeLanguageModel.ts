// A scriptable LanguageModel global for unit tests (10 section 15).
// Use with setLanguageModelForTests(installFakeLanguageModel(script)). Prompts honour their signal.
import type {
  LMCoreOptions,
  LMCreateOptions,
  LMMessage,
  LMPromptOptions,
  LanguageModelSession,
  LanguageModelStatic,
} from '../device/languageModel';

export interface FakeLanguageModelScript {
  availability: { text: string; image: string } | ((options: LMCoreOptions | undefined) => string | Promise<string>);
  respond?: (messages: LMMessage[], options?: LMPromptOptions) => string;
  chunks?: (messages: LMMessage[]) => string[];
  delayMs?: number;
  /** downloadprogress values fired through options.monitor before create() resolves. */
  progress?: number[];
  /** create() rejects with this. */
  createError?: unknown;
  /** clone() rejects with this, once per entry (then works). */
  cloneErrors?: unknown[];
}
export interface FakeCounters {
  creates: number;
  clones: number;
  prompts: number;
  destroys: number;
  aborts: number;
  availabilityCalls: number;
}
export interface FakeLanguageModel extends LanguageModelStatic {
  counters: FakeCounters;
  createOptions: LMCreateOptions[];
  availabilityOptions: (LMCoreOptions | undefined)[];
  /** The input of every prompt, in order (without the system prompt). */
  promptInputs: LMMessage[][];
  setAvailability(a: { text: string; image: string }): void;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function wait(ms: number, signal: AbortSignal | undefined, counters: FakeCounters): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      counters.aborts += 1;
      reject(abortError(signal));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        counters.aborts += 1;
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

function isImageOptions(o: LMCoreOptions | undefined): boolean {
  return (o?.expectedInputs ?? []).some((i) => i.type === 'image');
}

export function installFakeLanguageModel(script: FakeLanguageModelScript): FakeLanguageModel {
  let availability = script.availability;
  const counters: FakeCounters = { creates: 0, clones: 0, prompts: 0, destroys: 0, aborts: 0, availabilityCalls: 0 };
  const createOptions: LMCreateOptions[] = [];
  const availabilityOptions: (LMCoreOptions | undefined)[] = [];
  const promptInputs: LMMessage[][] = [];
  const cloneErrors = [...(script.cloneErrors ?? [])];

  const toMessages = (input: string | LMMessage[]): LMMessage[] =>
    typeof input === 'string' ? [{ role: 'user', content: input }] : input;

  const makeSession = (initial: LMMessage[]): LanguageModelSession => {
    let destroyed = false;
    const session: LanguageModelSession = {
      async prompt(input, options) {
        counters.prompts += 1;
        const messages = toMessages(input);
        promptInputs.push(messages);
        await wait(script.delayMs ?? 0, options?.signal, counters);
        if (destroyed) throw new DOMException('Session destroyed', 'InvalidStateError');
        return script.respond ? script.respond([...initial, ...messages], options) : '';
      },
      promptStreaming(input, options) {
        counters.prompts += 1;
        const messages = toMessages(input);
        promptInputs.push(messages);
        const pieces = script.chunks ? script.chunks([...initial, ...messages]) : [script.respond?.([...initial, ...messages], options) ?? ''];
        let i = 0;
        return new ReadableStream<string>({
          async pull(controller) {
            try {
              await wait(script.delayMs ?? 0, options?.signal, counters);
            } catch (e) {
              controller.error(e);
              return;
            }
            if (i >= pieces.length) {
              controller.close();
              return;
            }
            controller.enqueue(pieces[i]);
            i += 1;
          },
        });
      },
      async clone(options) {
        if (options?.signal?.aborted) throw abortError(options.signal);
        const err = cloneErrors.shift();
        if (err !== undefined) throw err;
        counters.clones += 1;
        return makeSession(initial);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        counters.destroys += 1;
      },
    };
    return session;
  };

  const lm: FakeLanguageModel = {
    counters,
    createOptions,
    availabilityOptions,
    promptInputs,
    setAvailability(a) {
      availability = a;
    },
    async availability(options) {
      counters.availabilityCalls += 1;
      availabilityOptions.push(options);
      if (typeof availability === 'function') return availability(options);
      return isImageOptions(options) ? availability.image : availability.text;
    },
    async create(options) {
      counters.creates += 1;
      createOptions.push(options ?? {});
      if (script.createError !== undefined) throw script.createError;
      if (options?.monitor && script.progress) {
        const listeners: ((e: { loaded: number }) => void)[] = [];
        options.monitor({ addEventListener: (_type, l) => listeners.push(l) });
        for (const loaded of script.progress) {
          await Promise.resolve();
          for (const l of listeners) l({ loaded });
        }
      }
      return makeSession(options?.initialPrompts ?? []);
    },
  };
  return lm;
}
