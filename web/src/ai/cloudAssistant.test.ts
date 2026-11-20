// The Playground assistant's loop (00 D1, D6, D8; 30 sections 8 and 16) with a fake GenerativeModel and a fake fetch
// that answers as the connector does.
import { describe, expect, it, vi } from 'vitest';
import { MCP_CHECK_INPUT_SCHEMA, MCP_LADDER_INPUT_SCHEMA, type ToolResult } from '@sieve/shared';
import {
  ASSISTANT_CAP_KEY,
  ASSISTANT_DAILY_CLOUD_CALLS,
  ASSISTANT_MAX_CHECKS,
  DEMO_LINE,
  MCP_PROTOCOL_VERSION,
  callSieveTool,
  cloudCallCap,
  connectorEndpoint,
  initializeConnector,
  parseToolResult,
  runCloudAssistant,
  systemInstructionFor,
  toolDeclarations,
  type AssistantContent,
  type AssistantEvent,
  type AssistantFunctionCall,
  type AssistantModel,
  type AssistantResponse,
  type ConnectorSession,
} from './cloudAssistant';

const SECRET = 'A'.repeat(43);
const ENDPOINT = `https://sieve.example/mcp/${SECRET}`;
const INSTRUCTIONS = 'Sieve answers questions about one person\'s own email, files and photos.\n\nHow to ask: start with sieve_answer.';
const DEPOSIT = 'Your deposit was $1,200, paid on March 3.';
const REQ = 'abcdefghij0123456789';
const QUESTION = 'what did my landord say abt the deposit last month';
const TOOLS = [
  { name: 'sieve_answer', description: 'Ask about the person\'s own email, files or photos.' },
  { name: 'sieve_excerpt', description: 'Same as sieve_answer, but the lines.' },
  { name: 'sieve_full_item', description: 'Same as sieve_answer, but the whole item.' },
  { name: 'sieve_check', description: 'Get the result of an earlier Sieve request whose status was "pending".' },
];
const CONNECTOR: ConnectorSession = { endpoint: ENDPOINT, instructions: INSTRUCTIONS, tools: TOOLS, protocolVersion: MCP_PROTOCOL_VERSION };

const pending: ToolResult = {
  status: 'pending',
  request_id: REQ,
  message: `The person has not approved this yet. Tell them a request is waiting in Sieve, then call sieve_check with request_id "${REQ}"; it waits up to 45 seconds for their decision.`,
};
const answered: ToolResult = { status: 'answered', request_id: REQ, step: 'answer', text: DEPOSIT, message: 'The person approved sharing this answer.' };
const declined: ToolResult = { status: 'declined', request_id: REQ, message: 'The person chose not to share this.' };
const nothing: ToolResult = { status: 'no-match', request_id: REQ, message: 'Nothing to share for that.' };

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { jsonrpc: string; id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
}

/** A fake connector: answers initialize, tools/list and notifications; tools/call from the handler. */
function fakeConnector(onCall: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult | { rpcError: string }> | ToolResult | { rpcError: string }) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Sent['body'];
    sent.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    const reply = (status: number, json?: unknown) =>
      ({ status, ok: status >= 200 && status < 300, json: async () => json }) as unknown as Response;
    if (body.method === 'initialize') {
      return reply(200, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sieve' }, instructions: INSTRUCTIONS } });
    }
    if (body.method.startsWith('notifications/')) return reply(202);
    if (body.method === 'tools/list') {
      return reply(200, { jsonrpc: '2.0', id: body.id, result: { tools: [...TOOLS.map((t) => ({ ...t, inputSchema: {} })), { name: 'other_tool', description: 'x' }] } });
    }
    const out = await onCall(body.params?.name ?? '', body.params?.arguments ?? {}, init?.signal as AbortSignal);
    if ('rpcError' in out) return reply(200, { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: out.rpcError } });
    return reply(200, {
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: out.status === 'error' },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, sent, calls: () => sent.filter((s) => s.body.method === 'tools/call') };
}

function respond(parts: Record<string, unknown>[], extra: Partial<AssistantResponse> = {}): { response: AssistantResponse } {
  const calls = parts.filter((p) => 'functionCall' in p).map((p) => p.functionCall as AssistantFunctionCall);
  const text = parts.filter((p) => 'text' in p).map((p) => p.text as string).join('');
  return {
    response: {
      candidates: [{ content: { role: 'model', parts: parts as unknown as AssistantContent['parts'] } }],
      functionCalls: () => (calls.length > 0 ? calls : undefined),
      text: () => text,
      inferenceSource: 'in_cloud',
      ...extra,
    },
  };
}

const ask = (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: 'functionCall', functionCall: { name, args }, ...extra });
const say = (text: string) => ({ type: 'text', text });

/** A fake GenerativeModel: each generateContent returns the next scripted turn and records the contents it got. */
function fakeModel(script: ((contents: AssistantContent[]) => { response: AssistantResponse } | Promise<{ response: AssistantResponse }>)[]) {
  const requests: AssistantContent[][] = [];
  const model: AssistantModel = {
    generateContent: vi.fn(async ({ contents }: { contents: AssistantContent[] }, opts: { signal: AbortSignal }) => {
      requests.push(structuredClone(contents));
      const next = script[requests.length - 1];
      if (!next) throw new Error('no more scripted turns');
      if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
      return next(contents);
    }),
  };
  return { model, requests };
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function run(model: AssistantModel, fetchImpl: typeof fetch, extra: Partial<Parameters<typeof runCloudAssistant>[0]> = {}) {
  const events: AssistantEvent[] = [];
  const promise = runCloudAssistant({
    question: QUESTION,
    connector: CONNECTOR,
    uid: 'anon-1',
    signal: new AbortController().signal,
    model,
    fetchImpl,
    cap: cloudCallCap('anon-1', { storage: memoryStorage() }),
    onEvent: (e) => events.push(e),
    ...extra,
  });
  return { promise, events };
}

const landlordArgs = { question: 'What did my landlord say about the deposit?', after: '2026-10-01', before: '2026-10-31', from: 'landlord' };

describe('the connector', () => {
  it('initializes in the legacy era, reads the server instructions and the tools this grant allows', async () => {
    const c = fakeConnector(() => answered);
    const session = await initializeConnector(ENDPOINT, { fetchImpl: c.fetchImpl });
    expect(c.sent.map((s) => s.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    for (const s of c.sent) {
      expect(s.url).toBe(ENDPOINT);
      expect(s.headers['Content-Type']).toBe('application/json');
      expect(s.headers['MCP-Protocol-Version']).toBe('2025-06-18');
      expect(s.body.jsonrpc).toBe('2.0');
    }
    expect(c.sent[0].body.params).toMatchObject({ protocolVersion: '2025-06-18' });
    expect(c.sent[1].body.id).toBeUndefined();
    expect(session.instructions).toBe(INSTRUCTIONS);
    expect(session.tools.map((t) => t.name)).toEqual(['sieve_answer', 'sieve_excerpt', 'sieve_full_item', 'sieve_check']);
  });

  it('calls the connector on this page\'s origin, whatever host the link names', () => {
    expect(connectorEndpoint(`https://sieve.manideep.info/mcp/${SECRET}`, 'http://localhost:5173')).toBe(`http://localhost:5173/mcp/${SECRET}`);
    expect(() => connectorEndpoint('https://sieve.example/other/path', 'http://localhost:5173')).toThrow('connector bad-link');
  });

  it('reads structuredContent, or the JSON in the text block when there is none', () => {
    expect(parseToolResult({ structuredContent: answered, content: [] })).toEqual(answered);
    expect(parseToolResult({ content: [{ type: 'text', text: JSON.stringify(nothing) }] })).toEqual(nothing);
    expect(parseToolResult({ content: [{ type: 'text', text: 'not json' }] })).toBeNull();
    expect(parseToolResult({ structuredContent: { status: 'surprise', message: 'x' } })).toBeNull();
  });

  it('turns a JSON-RPC error into an error result the model can act on; HTTP failures are connector errors', async () => {
    const c = fakeConnector(() => ({ rpcError: 'Unknown tool: sieve_delete' }));
    await expect(callSieveTool(CONNECTOR, 'sieve_delete', {}, { fetchImpl: c.fetchImpl })).resolves.toEqual({ status: 'error', message: 'Unknown tool: sieve_delete' });
    const gone = vi.fn(async () => ({ status: 404, ok: false, json: async () => ({ error: 'unknown_connector' }) }) as unknown as Response);
    await expect(callSieveTool(CONNECTOR, 'sieve_answer', {}, { fetchImpl: gone as unknown as typeof fetch })).rejects.toMatchObject({ code: 'http', status: 404 });
  });
});

describe('the model setup', () => {
  it('declares the four tools with the server descriptions and the shared input schemas, in the subset Gemini accepts', () => {
    const decls = toolDeclarations(TOOLS);
    expect(decls.map((d) => d.name)).toEqual(['sieve_answer', 'sieve_excerpt', 'sieve_full_item', 'sieve_check']);
    expect(decls[0].description).toBe(TOOLS[0].description);
    const ladder = decls[0].parameters as unknown as Record<string, unknown> & { properties: Record<string, Record<string, unknown>> };
    expect(ladder.type).toBe('object');
    expect(ladder.required).toEqual(['question']);
    expect(Object.keys(ladder.properties)).toEqual(Object.keys(MCP_LADDER_INPUT_SCHEMA.properties));
    expect(ladder.properties.source.enum).toEqual(['mail', 'files', 'photos']);
    expect(ladder.properties.question.description).toBe(MCP_LADDER_INPUT_SCHEMA.properties.question.description);
    expect(ladder.properties.terms).toMatchObject({ type: 'array', maxItems: 5, items: { type: 'string' } });
    const json = JSON.stringify(decls);
    for (const word of ['additionalProperties', 'minLength', 'maxLength', 'pattern']) expect(json).not.toContain(word);
    expect((decls[3].parameters as unknown as { required: string[] }).required).toEqual(MCP_CHECK_INPUT_SCHEMA.required);
  });

  it('uses the connector instructions as the system instruction, plus one demo line', () => {
    expect(systemInstructionFor(`${INSTRUCTIONS}\n`)).toBe(`${INSTRUCTIONS}\n\n${DEMO_LINE}`);
    expect(DEMO_LINE).toMatch(/sample data/);
  });
});

describe('runCloudAssistant', () => {
  it('pending, then answered: the page collects with sieve_check and Gemini receives exactly the approved text', async () => {
    let checks = 0;
    const c = fakeConnector((name) => {
      if (name === 'sieve_answer') return pending;
      checks += 1;
      return answered;
    });
    const sig = 'c2lnbmF0dXJl';
    const { model, requests } = fakeModel([
      () => respond([ask('sieve_answer', landlordArgs, { thoughtSignature: sig })]),
      () => respond([say('Your landlord confirmed they received your $1,200 deposit on March 3. Draft: Thanks for confirming!')]),
    ]);
    const { promise, events } = run(model, c.fetchImpl);
    const out = await promise;

    expect(out.outcome).toEqual({ kind: 'answered', text: 'Your landlord confirmed they received your $1,200 deposit on March 3. Draft: Thanks for confirming!' });
    expect(c.calls().map((s) => [s.body.params?.name, s.body.params?.arguments])).toEqual([
      ['sieve_answer', landlordArgs],
      ['sieve_check', { request_id: REQ }],
    ]);
    expect(checks).toBe(1);
    // Turn 2 got the model's own content back (with its thought signature) and one function response for its call.
    expect(requests[1]).toHaveLength(3);
    expect(requests[1][1]).toEqual({ role: 'model', parts: [{ type: 'functionCall', functionCall: { name: 'sieve_answer', args: landlordArgs }, thoughtSignature: sig }] });
    expect(requests[1][2]).toEqual({ role: 'user', parts: [{ type: 'functionResponse', functionResponse: { name: 'sieve_answer', response: answered } }] });
    // The transcript: Gemini's call (pending), the page's check (answered, handed to Gemini, 41 characters).
    expect(out.calls).toMatchObject([
      { tool: 'sieve_answer', by: 'gemini', status: 'pending', requestId: REQ, handedToGemini: false, chars: 0 },
      { tool: 'sieve_check', by: 'page', status: 'answered', requestId: REQ, handedToGemini: true, chars: DEPOSIT.length, received: JSON.stringify(answered) },
    ]);
    expect(DEPOSIT.length).toBe(41);
    expect(out.turns.map((t) => [t.n, t.functionCalls, t.source])).toEqual([[1, 1, 'in_cloud'], [2, 0, 'in_cloud']]);
    // Live events: the call appears as 'calling' before its result.
    const callEvents = events.filter((e): e is Extract<AssistantEvent, { type: 'call' }> => e.type === 'call');
    expect(callEvents[0].call).toMatchObject({ tool: 'sieve_answer', status: 'calling' });
    expect(callEvents.some((e) => e.call.tool === 'sieve_check' && e.call.status === 'calling')).toBe(true);
  });

  it('declined: Gemini receives the declined result and no text from the person\'s data', async () => {
    const c = fakeConnector(() => declined);
    const { model, requests } = fakeModel([
      () => respond([say('Let me ask Sieve.'), ask('sieve_answer', { question: 'What did my landlord say about the deposit?' })]),
      () => respond([say('The person chose not to share that.')]),
    ]);
    const out = await run(model, c.fetchImpl).promise;
    expect(out.outcome).toEqual({ kind: 'answered', text: 'The person chose not to share that.' });
    expect(out.notes).toEqual(['Let me ask Sieve.']);
    expect(out.calls).toMatchObject([{ tool: 'sieve_answer', status: 'declined', handedToGemini: true, chars: 0, received: JSON.stringify(declined) }]);
    expect(requests[1][2].parts[0]).toMatchObject({ functionResponse: { name: 'sieve_answer', response: declined } });
  });

  it('D6: a blocked or missing item reaches Gemini as "Nothing to share for that." and nothing else', async () => {
    const c = fakeConnector(() => nothing);
    const { model, requests } = fakeModel([
      () => respond([ask('sieve_answer', { question: 'What do my test results say?' })]),
      () => respond([say('Sieve had nothing to share for that.')]),
    ]);
    const out = await run(model, c.fetchImpl).promise;
    expect(out.outcome.kind).toBe('answered');
    expect(requests[1][2].parts).toEqual([{ type: 'functionResponse', functionResponse: { name: 'sieve_answer', response: nothing } }]);
    expect(out.calls[0]).toMatchObject({ status: 'no-match', chars: 0, received: '{"status":"no-match","request_id":"abcdefghij0123456789","message":"Nothing to share for that."}' });
  });

  it('checks a pending request at most three times, then hands Gemini the last pending result', async () => {
    const c = fakeConnector(() => pending);
    const { model, requests } = fakeModel([
      () => respond([ask('sieve_answer', landlordArgs)]),
      () => respond([say('A request is waiting in Sieve. Approve it there and ask me again.')]),
    ]);
    const out = await run(model, c.fetchImpl).promise;
    expect(c.calls().map((s) => s.body.params?.name)).toEqual(['sieve_answer', 'sieve_check', 'sieve_check', 'sieve_check']);
    expect(ASSISTANT_MAX_CHECKS).toBe(3);
    expect(out.calls.filter((x) => x.handedToGemini).map((x) => x.id)).toEqual(['call-4']);
    expect(requests[1][2].parts[0]).toMatchObject({ functionResponse: { name: 'sieve_answer', response: pending } });
    // A further sieve_check from Gemini is not sent once the three are used.
    const c2 = fakeConnector(() => pending);
    const { model: m2 } = fakeModel([
      () => respond([ask('sieve_answer', landlordArgs)]),
      () => respond([ask('sieve_check', { request_id: REQ })]),
      () => respond([say('Still waiting.')]),
    ]);
    const out2 = await run(m2, c2.fetchImpl).promise;
    expect(c2.calls()).toHaveLength(4);
    expect(out2.outcome).toEqual({ kind: 'answered', text: 'Still waiting.' });
  });

  it('cap reached: no model call past the daily limit, counted per visitor and per day', async () => {
    const storage = memoryStorage();
    let day = new Date(2026, 10, 18, 9).getTime();
    const cap = cloudCallCap('anon-1', { storage, limit: 1, now: () => day });
    const c = fakeConnector(() => answered);
    const { model } = fakeModel([() => respond([ask('sieve_answer', landlordArgs)]), () => respond([say('Done.')])]);
    const out = await run(model, c.fetchImpl, { cap }).promise;
    expect(out.outcome).toEqual({ kind: 'capped', limit: 1 });
    expect(model.generateContent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data.get(`${ASSISTANT_CAP_KEY}.anon-1`) ?? '')).toEqual({ day: '2026-11-18', n: 1 });

    // Already used up before the question: nothing is sent at all.
    const { model: m2 } = fakeModel([() => respond([say('x')])]);
    const out2 = await run(m2, c.fetchImpl, { cap }).promise;
    expect(out2.outcome).toEqual({ kind: 'capped', limit: 1 });
    expect(m2.generateContent).not.toHaveBeenCalled();
    // Another visitor, and the next day, start from zero.
    expect(cloudCallCap('anon-2', { storage, limit: 1, now: () => day }).remaining()).toBe(1);
    day += 24 * 60 * 60 * 1000;
    expect(cap.remaining()).toBe(1);
    expect(cloudCallCap('x', { storage: null }).limit).toBe(ASSISTANT_DAILY_CLOUD_CALLS);
  });

  it('abort: stops during the tool call and during the model call, and sends nothing more', async () => {
    const ctl = new AbortController();
    const c = fakeConnector((_name, _args, signal) => new Promise<ToolResult>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      setTimeout(() => ctl.abort(), 5);
    }));
    const { model } = fakeModel([() => respond([ask('sieve_answer', landlordArgs)]), () => respond([say('never')])]);
    const out = await run(model, c.fetchImpl, { signal: ctl.signal }).promise;
    expect(out.outcome).toEqual({ kind: 'aborted' });
    expect(model.generateContent).toHaveBeenCalledTimes(1);
    expect(out.calls[0].status).toBe('failed');

    const ctl2 = new AbortController();
    const { model: m2 } = fakeModel([() => new Promise((_resolve, reject) => {
      ctl2.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      ctl2.abort();
    })]);
    const out2 = await run(m2, fakeConnector(() => answered).fetchImpl, { signal: ctl2.signal }).promise;
    expect(out2.outcome).toEqual({ kind: 'aborted' });

    const ctl3 = new AbortController();
    ctl3.abort();
    const { model: m3 } = fakeModel([() => respond([say('x')])]);
    expect((await run(m3, fakeConnector(() => answered).fetchImpl, { signal: ctl3.signal }).promise).outcome).toEqual({ kind: 'aborted' });
    expect(m3.generateContent).not.toHaveBeenCalled();
  });

  it('maps model and connector failures', async () => {
    const quota = Object.assign(new Error('[429] (AI/fetch-error)'), { name: 'FirebaseError', code: 'fetch-error', customErrorData: { status: 429 } });
    const { model } = fakeModel([() => Promise.reject(quota)]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await run(model, fakeConnector(() => answered).fetchImpl).promise).outcome).toEqual({ kind: 'model-error', code: 'quota' });

    const gone = vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const { model: m2 } = fakeModel([() => respond([ask('sieve_answer', landlordArgs)])]);
    expect((await run(m2, gone).promise).outcome).toEqual({ kind: 'connector-error', code: 'http', status: 404 });

    const { model: m3 } = fakeModel([() => respond([])]);
    expect((await run(m3, fakeConnector(() => answered).fetchImpl).promise).outcome).toEqual({ kind: 'model-error', code: 'no-answer' });
    vi.restoreAllMocks();
  });
});
