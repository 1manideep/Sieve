// The Playground assistant panel (00 D1, D6, D8): every state with axe and exact copy. The loop and the connector are
// faked here (the loop has its own tests in web/src/ai/cloudAssistant.test.ts); the relay entries are set on the
// Playground relay store as the engine writes them.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES, type StepOption, type ToolResult } from '@sieve/shared';
import type { AssistantCall, AssistantEvent, AssistantRun, RunInput } from '@/ai/cloudAssistant';
import { DEPOSIT_ANSWER, healthBlocked, landlordReady } from '@/components/__fixtures__/proposals';
import { PLAYGROUND_ASSISTANT_COPY as COPY, fill } from '@/copy/screens-main';
import type { PendingEntry } from '@/state/homeBase';
import { usePlaygroundRelay } from '@/state/playgroundRelay';
import { useRecords } from '@/state/records';
import { useSession } from '@/state/session';
import type { RelayRequestView } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { setFakeAuthUser } from '@/test/fakes/firebaseAuth';
import { AssistantLauncher } from './AssistantLauncher';
import { AssistantPanel, callWait } from './AssistantPanel';
import { useAssistant } from './assistantStore';
import { ASSISTANT_SUGGESTIONS } from './suggestions';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/pipeline', () => ({ composeOutgoingText: (o: StepOption[]) => o.map((x) => x.text).join('\n\n') }));

const SECRET = 'B'.repeat(43);
const REQ = 'abcdefghij0123456789';
const grant = { grantId: 'g1', link: `https://sieve.example/mcp/${SECRET}`, linkHint: 'BBBB', maxStep: 'full', allowedCategories: [], allowedSources: ['playground'], expiresAt: 1 };
const stopRelay = vi.fn();
const connect = vi.fn(async (_uid: string) => ({ grant, stop: stopRelay }));
vi.mock('../playgroundAssistant', () => ({ connectPlaygroundAssistant: (uid: string) => connect(uid) }));

const connector = { endpoint: `http://localhost:3000/mcp/${SECRET}`, instructions: 'Sieve answers questions.', tools: [], protocolVersion: '2025-06-18' };
const initialize = vi.fn(async () => connector);
const runLoop = vi.fn<(input: RunInput) => Promise<AssistantRun>>();
vi.mock('@/ai/cloudAssistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ai/cloudAssistant')>()),
  initializeConnector: () => initialize(),
  runCloudAssistant: (input: RunInput) => runLoop(input),
}));

const LANDLORD = ASSISTANT_SUGGESTIONS[0];
const ARGS = { question: 'What did my landlord say about the deposit?', from: 'landlord' };
const pending: ToolResult = { status: 'pending', request_id: REQ, message: 'The person has not approved this yet.' };
const answered: ToolResult = { status: 'answered', request_id: REQ, step: 'answer', text: DEPOSIT_ANSWER, message: 'The person approved sharing this answer.' };
const nothing: ToolResult = { status: 'no-match', request_id: REQ, message: 'Nothing to share for that.' };

function call(over: Partial<AssistantCall>): AssistantCall {
  return { id: 'call-1', tool: 'sieve_answer', args: ARGS, by: 'gemini', status: 'calling', handedToGemini: false, chars: 0, ms: 0, startedAt: 1_000, ...over };
}

function request(over: Partial<RelayRequestView> = {}): RelayRequestView {
  return {
    id: REQ,
    requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini in the cloud' },
    tool: 'sieve_answer',
    requestedStep: 'answer',
    maxStep: 'full',
    allowedCategories: [...CATEGORIES],
    allowedSources: ['playground'],
    question: ARGS.question,
    status: 'awaiting-person',
    createdAt: 1_000,
    expireAt: 10_000_000_000_000,
    ...over,
  };
}

function entry(over: Partial<PendingEntry> = {}): PendingEntry {
  return {
    requestId: REQ,
    request: request(),
    phase: 'awaiting-person',
    liveSteps: [],
    answerPreview: '',
    proposal: { ...landlordReady, requestId: REQ, requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini in the cloud' }, question: ARGS.question },
    relatedSelected: [],
    relatedOptions: {},
    relatedLoading: [],
    lastPreviewItemIds: [],
    ...over,
  };
}

const decide = vi.fn(async () => ({ ok: true as const }));
function setRelay(list: PendingEntry[], status: 'idle' | 'starting' | 'running' | 'error' = 'running') {
  act(() => {
    usePlaygroundRelay.setState({
      status,
      entries: Object.fromEntries(list.map((e) => [e.requestId, e])),
      order: list.map((e) => e.requestId),
    });
  });
}

/** A scripted loop: emits the given events, then waits for `finish` (or the abort) before it resolves. */
function scriptedRun(events: AssistantEvent[], run: Omit<AssistantRun, 'outcome'> & { outcome: AssistantRun['outcome'] }) {
  let finish: () => void = () => undefined;
  runLoop.mockImplementationOnce(
    (input) =>
      new Promise<AssistantRun>((resolve) => {
        for (const e of events) input.onEvent?.(e);
        finish = () => resolve(run);
        input.signal.addEventListener('abort', () => resolve({ ...run, outcome: { kind: 'aborted' } }));
      }),
  );
  return () => act(() => finish());
}

/** A loop that emits its events and resolves at once. */
function instantRun(run: AssistantRun, events: AssistantEvent[] = []) {
  runLoop.mockImplementationOnce(async (input) => {
    for (const e of events) input.onEvent?.(e);
    return run;
  });
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <AssistantPanel />
    </MemoryRouter>,
  );
}

// The auth listener the panel starts reports this anonymous visitor.
setFakeAuthUser({ uid: 'anon-1', email: null, displayName: null, photoURL: null, isAnonymous: true });

beforeEach(() => {
  connect.mockClear();
  initialize.mockClear();
  runLoop.mockReset();
  stopRelay.mockClear();
  decide.mockClear();
  localStorage.clear();
  useSession.setState({ kind: 'anonymous', user: { uid: 'anon-1', isAnonymous: true }, ensureAnonymous: vi.fn(async () => undefined) });
  usePlaygroundRelay.setState({ status: 'idle', entries: {}, order: [], decide });
  useRecords.setState({ ensure: vi.fn(async () => undefined), meta: {} });
});
afterEach(() => {
  act(() => useAssistant.getState().disconnect());
});

describe('AssistantLauncher', () => {
  it('shows the D1 story and loads the panel only when opened; nothing connects on page load', async () => {
    const { container } = render(
      <MemoryRouter>
        <AssistantLauncher />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Gemini in the cloud asks; Gemini Nano on your device decides what it gets.' })).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Try the cloud assistant' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(COPY.honestTitle)).not.toBeInTheDocument();
    await expectNoAxeViolations(container);

    await userEvent.click(open);
    expect(await screen.findByText(COPY.honestTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide the cloud assistant' })).toHaveAttribute('aria-expanded', 'true');
    expect(connect).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);

    await userEvent.click(screen.getByRole('button', { name: 'Hide the cloud assistant' }));
    expect(screen.getByText(COPY.honestTitle).closest('[hidden]')).not.toBeNull();
  });
});

describe('AssistantPanel', () => {
  it('idle: the honest note, three suggestions with the landlord one first, the connect step and the empty device side', async () => {
    const { container } = renderPanel();
    expect(screen.getByText(COPY.honest)).toBeInTheDocument();
    expect(ASSISTANT_SUGGESTIONS).toEqual([
      'What did my landlord say about the deposit? Draft a reply.',
      'When does my flight to Seattle leave?',
      'What do my test results say?',
    ]);
    const chips = within(screen.getByText('Try asking Gemini').parentElement as HTMLElement).getAllByRole('button');
    expect(chips.map((b) => b.textContent)).toEqual([...ASSISTANT_SUGGESTIONS]);
    expect(screen.getByText(COPY.notConnected)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sieve on this device' })).toBeInTheDocument();
    expect(screen.getByText(COPY.deviceEmpty)).toBeInTheDocument();
    expect(screen.getByTestId('cap-remaining')).toHaveTextContent('30 of 30 cloud calls left today in this browser.');
    expect(connect).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('an empty question shows the error and calls nothing', async () => {
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Ask Gemini' }));
    expect(screen.getByText('Type a question first.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ask Gemini in the cloud' })).toHaveAttribute('aria-invalid', 'true');
    expect(connect).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('connecting: the first question connects once (grant, relay, connector), then asks', async () => {
    let release: () => void = () => undefined;
    connect.mockImplementationOnce((uid) => new Promise((resolve) => {
      release = () => resolve({ grant, stop: stopRelay });
      void uid;
    }));
    const done = scriptedRun([], { outcome: { kind: 'answered', text: 'Done.' }, calls: [], turns: [], notes: [] });
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: LANDLORD }));
    expect(screen.getAllByText(COPY.connecting).length).toBeGreaterThan(0);
    expect(connect).toHaveBeenCalledWith('anon-1');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await act(async () => release());
    await waitFor(() => expect(runLoop).toHaveBeenCalledOnce());
    expect(runLoop.mock.calls[0][0]).toMatchObject({ question: LANDLORD, connector, uid: 'anon-1' });
    expect(screen.getByText(COPY.connected)).toBeInTheDocument();
    done();
    expect(await screen.findByTestId('assistant-answer')).toHaveTextContent('Done.');

    // The second question reuses the link kept in memory.
    instantRun({ outcome: { kind: 'answered', text: 'Again.' }, calls: [], turns: [], notes: [] });
    await userEvent.click(screen.getByRole('button', { name: ASSISTANT_SUGGESTIONS[1] }));
    await waitFor(() => expect(runLoop).toHaveBeenCalledTimes(2));
    expect(connect).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledOnce();
  });

  it('waiting for your approval: the call with its arguments, and the relay approval card on the device side', async () => {
    const finish = scriptedRun(
      [{ type: 'model-start', n: 1 }, { type: 'call', call: call({}) }],
      { outcome: { kind: 'answered', text: 'x' }, calls: [], turns: [], notes: [] },
    );
    setRelay([entry()]);
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: LANDLORD }));
    const card = await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'Gemini called sieve_answer');
    const li = card.closest('li') as HTMLElement;
    expect(within(li).getByText('question')).toBeInTheDocument();
    expect(within(li).getByText(ARGS.question)).toBeInTheDocument();
    expect(within(li).getByText('from')).toBeInTheDocument();
    expect(within(li).getByTestId('call-wait')).toHaveTextContent('Waiting for your approval Approve or decline it under "Sieve on this device".');
    const approval = screen.getByRole('article', { name: 'Request from Gemini in the cloud' });
    expect(within(approval).getByTestId('outgoing-text')).toHaveTextContent(DEPOSIT_ANSWER);
    await expectNoAxeViolations(container);

    await userEvent.click(within(approval).getByRole('button', { name: 'Approve, 41 characters' }));
    expect(decide).toHaveBeenCalledWith({ requestId: REQ, approved: true, step: 'answer', decidedBy: 'app' });
    finish();
  });

  it('answered: exactly what Gemini received and how many characters, the answer, and the two-lane trace', async () => {
    const calls = [
      call({ status: 'pending', result: pending, requestId: REQ, ms: 45_000 }),
      call({ id: 'call-2', tool: 'sieve_check', args: { request_id: REQ }, by: 'page', status: 'answered', result: answered, requestId: REQ, handedToGemini: true, chars: 41, received: JSON.stringify(answered), ms: 3_000, startedAt: 46_000 }),
    ];
    const turns = [
      { n: 1, ms: 900, at: 0, functionCalls: 1, source: 'in_cloud' as const, model: 'gemini-test' },
      { n: 2, ms: 1200, at: 50_000, functionCalls: 0, source: 'in_cloud' as const, model: 'gemini-test' },
    ];
    instantRun({ outcome: { kind: 'answered', text: 'Your landlord got your $1,200 deposit on March 3.' }, calls, turns, notes: [] });
    setRelay([entry({ phase: 'done', result: { kind: 'sent', step: 'answer', itemCount: 1, by: 'app' } })]);
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: LANDLORD }));

    expect(await screen.findByTestId('assistant-answer')).toHaveTextContent("Gemini's answerYour landlord got your $1,200 deposit on March 3.");
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === "The page called sieve_check for Gemini, as Sieve's instructions say")).toBeInTheDocument();
    expect(screen.getByTestId('received-chars')).toHaveTextContent('Gemini received 41 characters of your data');
    expect(screen.getByTestId('received-text')).toHaveTextContent(DEPOSIT_ANSWER);
    expect(screen.getByTestId('received-json')).toHaveTextContent(JSON.stringify(answered));
    expect(screen.getAllByTestId('received-chars')).toHaveLength(1);
    // Two lanes: Sieve's steps on this device, then what Gemini did in the cloud; 41 characters crossed.
    const trace = screen.getByRole('region', { name: 'Where each step ran' });
    expect(within(trace).getByTestId('lane-arrow')).toHaveTextContent('41 characters crossed to the cloud');
    expect(within(trace).getByTestId('trace-total')).toHaveTextContent('41 characters left this device');
    expect(within(trace).getByText('Gemini in the cloud received 41 characters you approved')).toBeInTheDocument();
    expect(within(trace).getByText('Gemini wrote its reply in the cloud (2 model calls)')).toBeInTheDocument();
    expect(within(trace).getByText('You approved: Answer only')).toBeInTheDocument();
    expect(screen.getByText('Sent the answer to Gemini in the cloud. Receipt saved.')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('D6: Gemini hears "Nothing to share for that." while the device side shows the real reason', async () => {
    const calls = [call({ status: 'no-match', result: nothing, requestId: REQ, handedToGemini: true, received: JSON.stringify(nothing), ms: 2_000 })];
    instantRun({ outcome: { kind: 'answered', text: 'Sieve had nothing to share for that.' }, calls, turns: [{ n: 1, ms: 1, at: 0, functionCalls: 1, source: 'in_cloud', model: 'm' }, { n: 2, ms: 1, at: 1, functionCalls: 0, source: 'in_cloud', model: 'm' }], notes: [] });
    setRelay([entry({ phase: 'done', request: request({ question: 'What do my test results say?' }), proposal: { ...healthBlocked, requestId: REQ }, result: { kind: 'auto', status: 'blocked' } })]);
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: ASSISTANT_SUGGESTIONS[2] }));
    expect(await screen.findByTestId('received-chars')).toHaveTextContent(COPY.receivedNone);
    expect(screen.getByTestId('received-json')).toHaveTextContent('{"status":"no-match","request_id":"abcdefghij0123456789","message":"Nothing to share for that."}');
    expect(screen.getByText('Health is never shared, so Sieve told Gemini in the cloud no. Nothing left this device, and no model read the item.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Where each step ran' })).getByTestId('lane-arrow')).toHaveTextContent('Nothing crossed to the cloud');
    await expectNoAxeViolations(container);
  });

  it('cap reached: the exact message, in the conversation and under the box', async () => {
    instantRun({ outcome: { kind: 'capped', limit: 30 }, calls: [], turns: [], notes: [] });
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: LANDLORD }));
    const message = "This browser has used today's 30 cloud calls for the Playground assistant. Try again tomorrow; everything else in the Playground still works.";
    expect(fill(COPY.capReached, { limit: 30 })).toBe(message);
    expect(await screen.findByText(message, { selector: 'li p' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    // With the day's calls used up, the line under the box says so too.
    localStorage.setItem('sieve.playgroundAssistant.cloudCalls.anon-1', JSON.stringify({ day: new Date().toLocaleDateString('en-CA'), n: 30 }));
    act(() => useAssistant.setState((s) => ({ capVersion: s.capVersion + 1 })));
    expect(screen.getByTestId('cap-remaining')).toHaveTextContent(message);
  });

  it('Stop aborts the question and says so; a failed connection says so and connects again next time', async () => {
    scriptedRun([{ type: 'model-start', n: 1 }], { outcome: { kind: 'answered', text: 'x' }, calls: [], turns: [], notes: [] });
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: LANDLORD }));
    expect(await screen.findByText(COPY.thinking)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText(COPY.stopped)).toBeInTheDocument();
    await expectNoAxeViolations(container);

    act(() => useAssistant.getState().disconnect());
    expect(stopRelay).toHaveBeenCalledOnce();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    initialize.mockRejectedValueOnce(new Error('connector bad-reply'));
    await userEvent.click(screen.getByRole('button', { name: LANDLORD }));
    expect(await screen.findByText(COPY.connectFailed, { selector: 'p' })).toBeInTheDocument();
    expect(stopRelay).toHaveBeenCalledTimes(2);   // the relay started for the failed link is stopped again
    await expectNoAxeViolations(container);
    vi.restoreAllMocks();
  });

  it('model errors and a lost connector read as one sentence each', async () => {
    instantRun({ outcome: { kind: 'model-error', code: 'app-check' }, calls: [], turns: [], notes: [] });
    const { container } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: LANDLORD }));
    expect(await screen.findByText(COPY.modelAppCheck)).toBeInTheDocument();
    instantRun({ outcome: { kind: 'connector-error', code: 'http', status: 404 }, calls: [], turns: [], notes: [] });
    await userEvent.click(screen.getByRole('button', { name: ASSISTANT_SUGGESTIONS[1] }));
    expect(await screen.findByText(COPY.connectorLost)).toBeInTheDocument();
    expect(stopRelay).toHaveBeenCalledOnce();      // the link is gone: the next question connects again
    expect(screen.getByText(COPY.notConnected)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('device side: starting, preparing, and a relay that could not start', async () => {
    setRelay([], 'starting');
    const { container } = renderPanel();
    expect(screen.getByText(COPY.deviceStarting)).toBeInTheDocument();
    setRelay([entry({ phase: 'preparing', proposal: undefined, liveSteps: [{ id: 's1', kind: 'retrieve', label: 'Searching on this device…', where: 'code', status: 'running', startedAt: Date.now() }] })]);
    expect(screen.getByTestId('preparing-card')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    setRelay([], 'error');
    expect(screen.getByText(COPY.deviceError)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('callWait', () => {
  it('reads the relay entry for the call; a page check means the person has not decided', () => {
    const entries = { [REQ]: entry({ phase: 'preparing' }) };
    expect(callWait(call({}), entries)).toBe('sieve');
    expect(callWait(call({}), { [REQ]: entry() })).toBe('approval');
    expect(callWait(call({ by: 'page', tool: 'sieve_check', args: { request_id: 'zzzzzzzzzzzzzzzzzzzz' } }), {})).toBe('approval');
    expect(callWait(call({}), {})).toBe('sieve');
  });
});
