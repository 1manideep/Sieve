// The Playground's outside assistant (00 D1 and D8, 30 sections 8 and 16): cloud Gemini, through Firebase AI Logic
// function calling, plays an outside AI that asks Sieve over the real MCP connector. The page carries out each function
// call as a JSON-RPC tools/call POST to the connector link (legacy era, MCP-Protocol-Version 2025-06-18) and hands the
// tool result back as the function response. Cloud only (a GenerativeModel with no device adapter, ONLY_IN_CLOUD) and
// sample data only: the Playground grant reaches nothing but the Playground's sample data, and what comes back is only
// what the person approved on this device. The system instruction is the connector's own MCP instructions.
import {
  FunctionCallingMode,
  GenerativeModel,
  GoogleAIBackend,
  ThinkingLevel,
  getAI,
  type AI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type ObjectSchemaRequest,
  type Part,
  type SchemaRequest,
} from 'firebase/ai';
import { getApp } from 'firebase/app';
import { LADDER_STEPS, MCP_CHECK_INPUT_SCHEMA, MCP_LADDER_INPUT_SCHEMA, MCP_TOOLS, type LadderStep, type ToolResult } from '@sieve/shared';
import { CLOUD_MODEL_DRAFT } from './config';
import { isE2E } from './e2e';
import { mapError } from './errors';
import { getAiInstance } from './init';

export type AssistantContent = Content;
export type AssistantFunctionCall = FunctionCall;

/** Legacy era (30 section 8.2): the server negotiates this version and sends structuredContent with it. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const ASSISTANT_MODEL = CLOUD_MODEL_DRAFT;
/** 00 D8: cloud calls per visitor (uid) per day in this browser. A question usually takes two. */
export const ASSISTANT_DAILY_CLOUD_CALLS = 30;
export const ASSISTANT_CAP_KEY = 'sieve.playgroundAssistant.cloudCalls';
/** sieve_check calls per question; each waits about 20 s on the server for the person's decision (30 section 8.5). */
export const ASSISTANT_MAX_CHECKS = 9;
export const ASSISTANT_MAX_TOOL_CALLS = 4;          // ladder tool calls Gemini may make per question
export const ASSISTANT_MAX_TURNS = 6;               // model calls per question
export const ASSISTANT_MAX_OUTPUT_TOKENS = 2048;
export const MCP_CALL_TIMEOUT_MS = 65_000;          // the server replies before t0 + 55 s; Hosting cuts at 60 s
export const MCP_SETUP_TIMEOUT_MS = 20_000;
export const MODEL_TIMEOUT_MS = 60_000;

/** The one line added after the connector's instructions. */
export const DEMO_LINE =
  "This is a demo in the Sieve Playground: the person's email, files and photos are sample data on a pretend computer in their browser.";
/** Sent to Gemini (never shown as Sieve's words) when it asks for more checks or tools than one question allows. */
export const LIMIT_RESULT_MESSAGE =
  'This demo allows no more Sieve calls for this question. Tell the person what you have, or that the request is still waiting in Sieve.';

const LINK_PATH_RE = /^\/mcp\/[A-Za-z0-9_-]{43}\/?$/;
const SIEVE_TOOLS = new Set<string>(Object.values(MCP_TOOLS));
const STATUSES = new Set<ToolResult['status']>(['answered', 'pending', 'declined', 'blocked', 'no-match', 'unsupported', 'offline', 'expired', 'unknown', 'not-allowed', 'error']);

// ---------------------------------------------------------------------------------------------------------------
// The connector (30 section 8)

export type ConnectorErrorCode = 'bad-link' | 'unreachable' | 'timeout' | 'http' | 'bad-reply';

export class ConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode, readonly status?: number) {
    super(`connector ${code}${status ? ` ${status}` : ''}`);
    this.name = 'ConnectorError';
  }
}

export interface ConnectorTool {
  name: string;
  description: string;
}

/** What the page keeps in memory for the session: never stored, logged or sent anywhere but the connector. */
export interface ConnectorSession {
  endpoint: string;
  instructions: string;
  tools: ConnectorTool[];
  protocolVersion: string;
}

interface RpcOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type RpcReply = { result: unknown } | { error: { code: number; message: string } };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * The connector on this page's own origin (30 section 16: same origin, allowed by the Origin check). Hosting serves
 * /mcp/<secret> on every app domain, and the dev server proxies it to the functions emulator.
 */
export function connectorEndpoint(link: string, origin: string = window.location.origin): string {
  let path: string;
  try {
    path = new URL(link, origin).pathname;
  } catch {
    throw new ConnectorError('bad-link');
  }
  if (!LINK_PATH_RE.test(path)) throw new ConnectorError('bad-link');
  return new URL(path, origin).toString();
}

let rpcId = 0;

async function postRpc(endpoint: string, message: Record<string, unknown>, opts: RpcOptions): Promise<RpcReply | undefined> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const ctl = new AbortController();
  const outer = opts.signal;
  const onAbort = () => ctl.abort();
  if (outer?.aborted) throw abortError();
  outer?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, opts.timeoutMs);
  try {
    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', ...message }),
        signal: ctl.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      if (outer?.aborted) throw abortError();
      throw new ConnectorError(timedOut ? 'timeout' : 'unreachable');
    }
    if (res.status === 202) return undefined;
    if (!res.ok) throw new ConnectorError('http', res.status);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      if (outer?.aborted) throw abortError();
      throw new ConnectorError(timedOut ? 'timeout' : 'bad-reply');
    }
    if (!isObject(body)) throw new ConnectorError('bad-reply');
    if (isObject(body.error)) {
      const { code, message: text } = body.error;
      return { error: { code: typeof code === 'number' ? code : -32603, message: typeof text === 'string' ? text : '' } };
    }
    if (!('result' in body)) throw new ConnectorError('bad-reply');
    return { result: body.result };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

async function request(endpoint: string, method: string, params: Record<string, unknown>, opts: RpcOptions): Promise<RpcReply> {
  rpcId += 1;
  const reply = await postRpc(endpoint, { id: rpcId, method, params }, opts);
  if (!reply) throw new ConnectorError('bad-reply');
  return reply;
}

/**
 * initialize (for the server's instructions, 30 section 8.3), notifications/initialized, then tools/list (the tools
 * this grant allows, with their exact descriptions). The server keeps no session, so this is done once per page.
 */
export async function initializeConnector(
  endpoint: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ConnectorSession> {
  const rpc: RpcOptions = { signal: opts.signal, timeoutMs: MCP_SETUP_TIMEOUT_MS, fetchImpl: opts.fetchImpl };
  const init = await request(
    endpoint,
    'initialize',
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'sieve-playground-assistant', title: 'Gemini in the cloud (Sieve Playground)', version: '1.0.0' },
    },
    rpc,
  );
  if (!('result' in init) || !isObject(init.result)) throw new ConnectorError('bad-reply');
  const { instructions, protocolVersion } = init.result;
  if (typeof instructions !== 'string' || instructions.trim() === '') throw new ConnectorError('bad-reply');
  await postRpc(endpoint, { method: 'notifications/initialized' }, rpc);
  const list = await request(endpoint, 'tools/list', {}, rpc);
  if (!('result' in list) || !isObject(list.result) || !Array.isArray(list.result.tools)) throw new ConnectorError('bad-reply');
  const tools: ConnectorTool[] = [];
  for (const t of list.result.tools) {
    if (isObject(t) && typeof t.name === 'string' && SIEVE_TOOLS.has(t.name)) {
      tools.push({ name: t.name, description: typeof t.description === 'string' ? t.description : '' });
    }
  }
  if (tools.length === 0) throw new ConnectorError('bad-reply');
  return {
    endpoint,
    instructions,
    tools,
    protocolVersion: typeof protocolVersion === 'string' ? protocolVersion : MCP_PROTOCOL_VERSION,
  };
}

function asToolResult(v: unknown): ToolResult | null {
  if (!isObject(v) || typeof v.status !== 'string' || !STATUSES.has(v.status as ToolResult['status']) || typeof v.message !== 'string') {
    return null;
  }
  // Only the ToolResult fields, in the order the server writes them (30 section 8.6).
  const out = { status: v.status } as ToolResult;
  if (typeof v.request_id === 'string') out.request_id = v.request_id;
  if (typeof v.step === 'string' && (LADDER_STEPS as readonly string[]).includes(v.step)) out.step = v.step as LadderStep;
  if (typeof v.text === 'string') out.text = v.text;
  out.message = v.message;
  return out;
}

/** A CallToolResult (30 section 8.6): structuredContent when present, else the JSON in the first text block. */
export function parseToolResult(raw: unknown): ToolResult | null {
  if (!isObject(raw)) return null;
  const structured = asToolResult(raw.structuredContent);
  if (structured) return structured;
  const content = Array.isArray(raw.content) ? raw.content : [];
  for (const block of content) {
    if (isObject(block) && block.type === 'text' && typeof block.text === 'string') {
      try {
        const parsed = asToolResult(JSON.parse(block.text));
        if (parsed) return parsed;
      } catch {
        // Not JSON: keep looking.
      }
    }
  }
  return null;
}

/** One tools/call. A JSON-RPC error (an unknown tool, bad params) becomes an error result the model can act on. */
export async function callSieveTool(
  connector: Pick<ConnectorSession, 'endpoint'>,
  name: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ToolResult> {
  const reply = await request(connector.endpoint, 'tools/call', { name, arguments: args }, {
    signal: opts.signal,
    timeoutMs: MCP_CALL_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl,
  });
  if ('error' in reply) return { status: 'error', message: reply.error.message || 'The connector returned an error.' };
  const result = parseToolResult(reply.result);
  if (!result) throw new ConnectorError('bad-reply');
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// The model

const GEMINI_SCHEMA_KEYS = ['type', 'description', 'enum', 'items', 'properties', 'required', 'minItems', 'maxItems'] as const;

/**
 * A JSON schema in the subset Gemini function declarations accept. minLength, maxLength, pattern and
 * additionalProperties are dropped: the server enforces them and returns a message the model can act on (30 section 8.7).
 */
export function toGeminiSchema(schema: Record<string, unknown>): SchemaRequest {
  const out: Record<string, unknown> = {};
  for (const key of GEMINI_SCHEMA_KEYS) {
    const value = schema[key];
    if (value === undefined) continue;
    if (key === 'items' && isObject(value)) out.items = toGeminiSchema(value);
    else if (key === 'properties' && isObject(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, isObject(sub) ? toGeminiSchema(sub) : sub]),
      );
    } else out[key] = value;
  }
  return out as SchemaRequest;
}

/** The connector's tools as Gemini function declarations: its own descriptions, the shared input schemas (01 section 7). */
export function toolDeclarations(tools: ConnectorTool[]): FunctionDeclaration[] {
  return tools
    .filter((t) => SIEVE_TOOLS.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiSchema(
        (t.name === MCP_TOOLS.check ? MCP_CHECK_INPUT_SCHEMA : MCP_LADDER_INPUT_SCHEMA) as Record<string, unknown>,
      ) as ObjectSchemaRequest,
    }));
}

/** The connector's MCP instructions (30 section 8.3), which the assistant must follow, plus the demo line. */
export function systemInstructionFor(instructions: string): string {
  return `${instructions.trim()}\n\n${DEMO_LINE}`;
}

/** The parts of a model response the loop reads (GenerativeModel's EnhancedGenerateContentResponse has them). */
export interface AssistantResponse {
  candidates?: { content?: Content }[];
  functionCalls(): FunctionCall[] | undefined;
  text(): string;
  inferenceSource?: string;
}

/** The part of GenerativeModel the loop uses, so tests can pass a fake. */
export interface AssistantModel {
  generateContent(request: { contents: Content[] }, options: { signal: AbortSignal; timeout: number }): Promise<{ response: AssistantResponse }>;
}

function assistantAi(): AI {
  // 60 section 3.9.1: with the e2e seam on, initAi starts neither App Check nor the AI backend, so e2e builds use a
  // plain instance and Playwright answers its requests. Production builds drop this branch.
  if (isE2E()) return getAI(getApp(), { backend: new GoogleAIBackend() });
  return getAiInstance();
}

/** Cloud only: no device adapter, so the SDK can only run it in the cloud (10 section 6.2, ONLY_IN_CLOUD). */
export function createAssistantModel(connector: Pick<ConnectorSession, 'instructions' | 'tools'>): AssistantModel {
  return new GenerativeModel(assistantAi(), {
    model: ASSISTANT_MODEL,
    systemInstruction: systemInstructionFor(connector.instructions),
    tools: [{ functionDeclarations: toolDeclarations(connector.tools) }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
    generationConfig: { maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The daily cap (00 D8)

export interface CloudCallCap {
  limit: number;
  used(): number;
  remaining(): number;
  /** Counts one cloud call; false (and nothing counted) when today's limit is reached. */
  take(): boolean;
}

type CapStorage = Pick<Storage, 'getItem' | 'setItem'>;
const memoryCounts = new Map<string, string>();

function defaultStorage(): CapStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Per uid and local day, in localStorage (memory when storage is blocked). A visitor can clear it; App Check and the project's budget alert are the server-side guard. */
export function cloudCallCap(
  uid: string,
  opts: { limit?: number; storage?: CapStorage | null; now?: () => number } = {},
): CloudCallCap {
  const limit = opts.limit ?? ASSISTANT_DAILY_CLOUD_CALLS;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? Date.now;
  const key = `${ASSISTANT_CAP_KEY}.${uid}`;
  const read = (): string | null => {
    try {
      if (storage) return storage.getItem(key);
    } catch {
      // Blocked storage: fall through to memory.
    }
    return memoryCounts.get(key) ?? null;
  };
  const write = (value: string): void => {
    memoryCounts.set(key, value);
    try {
      storage?.setItem(key, value);
    } catch {
      // Memory keeps the count for this page.
    }
  };
  const used = (): number => {
    try {
      const v: unknown = JSON.parse(read() ?? 'null');
      if (isObject(v) && v.day === localDay(now()) && typeof v.n === 'number' && v.n >= 0) return Math.floor(v.n);
    } catch {
      // A broken value counts as a fresh day.
    }
    return 0;
  };
  return {
    limit,
    used,
    remaining: () => Math.max(0, limit - used()),
    take() {
      const n = used();
      if (n >= limit) return false;
      write(JSON.stringify({ day: localDay(now()), n: n + 1 }));
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The loop

export interface AssistantCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** gemini: the model asked for it. page: the page's sieve_check for a pending result, as the server's instructions say. */
  by: 'gemini' | 'page';
  status: 'calling' | 'failed' | ToolResult['status'];
  requestId?: string;
  result?: ToolResult;
  /** True for the result that was handed to Gemini as the function response. */
  handedToGemini: boolean;
  /** Exactly what Gemini received for this call (the function response), as JSON. */
  received?: string;
  /** Characters of the person's data in what Gemini received (the approved text; 0 unless answered). */
  chars: number;
  ms: number;
  startedAt: number;
}

export interface ModelTurn {
  n: number;
  ms: number;
  at: number;
  functionCalls: number;
  source: 'in_cloud' | 'on_device';
  model: string;
}

export type ModelFailure = 'quota' | 'app-check' | 'timeout' | 'offline' | 'no-answer' | 'other';

export type AssistantOutcome =
  | { kind: 'answered'; text: string }
  | { kind: 'capped'; limit: number }
  | { kind: 'aborted' }
  | { kind: 'model-error'; code: ModelFailure }
  | { kind: 'connector-error'; code: ConnectorErrorCode; status?: number }
  | { kind: 'limit' };

export type AssistantEvent =
  | { type: 'model-start'; n: number }
  | { type: 'model-end'; turn: ModelTurn }
  | { type: 'note'; text: string }
  | { type: 'call'; call: AssistantCall };

export interface AssistantRun {
  outcome: AssistantOutcome;
  calls: AssistantCall[];
  turns: ModelTurn[];
  notes: string[];
}

export interface RunInput {
  question: string;
  connector: ConnectorSession;
  uid: string;
  signal: AbortSignal;
  onEvent?(event: AssistantEvent): void;
  model?: AssistantModel;
  fetchImpl?: typeof fetch;
  cap?: CloudCallCap;
  now?: () => number;
}

function modelFailure(error: unknown): ModelFailure {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  const m = mapError(error, { mode: 'ONLY_IN_CLOUD', timedOut: false, callerAborted: false });
  if (m.code === 'quota' || m.code === 'app-check' || m.code === 'timeout') return m.code;
  if (m.code === 'aborted') return 'timeout';       // the SDK's own timeout; the caller's abort is handled before this
  if (m.code === 'bad-output') return 'no-answer';
  if (error instanceof TypeError && /fetch/i.test(error.message)) return 'offline';
  return 'other';
}

function functionCallsOf(response: AssistantResponse): FunctionCall[] {
  try {
    return (response.functionCalls() ?? []).filter((c) => typeof c.name === 'string' && c.name !== '');
  } catch {
    return [];
  }
}

function textOf(response: AssistantResponse): string {
  try {
    return response.text().trim();
  } catch {
    return '';
  }
}

/**
 * One question: model turn, then every function call it made carried out on the connector, then the results back as
 * function responses, until Gemini answers in text. A pending result is collected with sieve_check (the server waits
 * about 20 s for the person's decision on each), at most ASSISTANT_MAX_CHECKS times per question; the final result is
 * what Gemini receives for its call. Every model call counts against the daily cap first.
 */
export async function runCloudAssistant(input: RunInput): Promise<AssistantRun> {
  const now = input.now ?? Date.now;
  const cap = input.cap ?? cloudCallCap(input.uid);
  const calls: AssistantCall[] = [];
  const turns: ModelTurn[] = [];
  const notes: string[] = [];
  const { signal } = input;
  const emit = (event: AssistantEvent) => {
    try {
      input.onEvent?.(event);
    } catch (error) {
      console.error('cloud assistant listener', error);
    }
  };
  const done = (outcome: AssistantOutcome): AssistantRun => ({ outcome, calls: calls.map((c) => ({ ...c })), turns, notes });

  if (signal.aborted) return done({ kind: 'aborted' });
  let model: AssistantModel;
  try {
    model = input.model ?? createAssistantModel(input.connector);
  } catch (error) {
    console.error('cloud assistant model', error);
    return done({ kind: 'model-error', code: 'other' });
  }

  let seq = 0;
  let checks = 0;
  let ladderCalls = 0;
  const update = (call: AssistantCall, patch: Partial<AssistantCall>): AssistantCall => {
    Object.assign(call, patch);
    emit({ type: 'call', call: { ...call } });
    return call;
  };
  const execute = async (tool: string, args: Record<string, unknown>, by: AssistantCall['by']): Promise<{ call: AssistantCall; result: ToolResult }> => {
    seq += 1;
    const call: AssistantCall = { id: `call-${seq}`, tool, args, by, status: 'calling', handedToGemini: false, chars: 0, ms: 0, startedAt: now() };
    if (typeof args.request_id === 'string') call.requestId = args.request_id;
    calls.push(call);
    emit({ type: 'call', call: { ...call } });
    try {
      const result = await callSieveTool(input.connector, tool, args, { signal, fetchImpl: input.fetchImpl });
      update(call, {
        status: result.status,
        result,
        requestId: result.request_id ?? call.requestId,
        chars: result.status === 'answered' ? (result.text ?? '').length : 0,
        ms: now() - call.startedAt,
      });
      return { call, result };
    } catch (error) {
      update(call, { status: 'failed', ms: now() - call.startedAt });
      throw error;
    }
  };

  const contents: Content[] = [{ role: 'user', parts: [{ type: 'text', text: input.question }] }];
  for (let n = 1; n <= ASSISTANT_MAX_TURNS; n += 1) {
    if (!cap.take()) return done({ kind: 'capped', limit: cap.limit });
    emit({ type: 'model-start', n });
    const t0 = now();
    let response: AssistantResponse;
    try {
      ({ response } = await model.generateContent({ contents }, { signal, timeout: MODEL_TIMEOUT_MS }));
    } catch (error) {
      if (signal.aborted) return done({ kind: 'aborted' });
      console.error('cloud assistant model call', (error as { code?: string } | null)?.code ?? '');
      return done({ kind: 'model-error', code: modelFailure(error) });
    }
    if (signal.aborted) return done({ kind: 'aborted' });
    const fnCalls = functionCallsOf(response);
    const turn: ModelTurn = {
      n,
      ms: now() - t0,
      at: t0,
      functionCalls: fnCalls.length,
      source: response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud',
      model: ASSISTANT_MODEL,
    };
    turns.push(turn);
    emit({ type: 'model-end', turn });
    const text = textOf(response);
    if (fnCalls.length === 0) {
      return text ? done({ kind: 'answered', text }) : done({ kind: 'model-error', code: 'no-answer' });
    }
    if (text) {
      notes.push(text);
      emit({ type: 'note', text });
    }
    // The model's own content goes back as it came, so any thought signatures stay with their function calls.
    const modelContent = response.candidates?.[0]?.content;
    contents.push(
      modelContent && Array.isArray(modelContent.parts) && modelContent.parts.length > 0
        ? { role: 'model', parts: modelContent.parts }
        : { role: 'model', parts: fnCalls.map((functionCall): Part => ({ type: 'functionCall', functionCall })) },
    );

    const parts: Part[] = [];
    for (const fc of fnCalls) {
      const args = isObject(fc.args) ? (fc.args as Record<string, unknown>) : {};
      let result: ToolResult;
      let last: AssistantCall | undefined;
      try {
        const isCheck = fc.name === MCP_TOOLS.check;
        if (isCheck ? checks >= ASSISTANT_MAX_CHECKS : ladderCalls >= ASSISTANT_MAX_TOOL_CALLS) {
          result = { status: 'error', message: LIMIT_RESULT_MESSAGE };
        } else {
          if (isCheck) checks += 1;
          else ladderCalls += 1;
          ({ call: last, result } = await execute(fc.name, args, 'gemini'));
          // 30 section 8.3: on pending, call sieve_check with the request_id. The page does it for Gemini, so a wait
          // for the person costs no extra cloud call.
          while (result.status === 'pending' && result.request_id && checks < ASSISTANT_MAX_CHECKS) {
            checks += 1;
            ({ call: last, result } = await execute(MCP_TOOLS.check, { request_id: result.request_id }, 'page'));
          }
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return done({ kind: 'aborted' });
        if (error instanceof ConnectorError) return done({ kind: 'connector-error', code: error.code, status: error.status });
        console.error('cloud assistant tool call', error);
        return done({ kind: 'connector-error', code: 'bad-reply' });
      }
      if (last) update(last, { handedToGemini: true, received: JSON.stringify(result) });
      parts.push({ type: 'functionResponse', functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response: result } });
    }
    contents.push({ role: 'user', parts });
  }
  return done({ kind: 'limit' });
}
