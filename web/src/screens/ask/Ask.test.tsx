import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Proposal, StepOption } from '@sieve/shared';
import type { PrepareInput } from '@/pipeline';
import { useAskReal } from '@/state/ask';
import { useAvailability } from '@/state/availability';
import { useIndexing } from '@/state/indexing';
import { useRecords } from '@/state/records';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { expectNoAxeViolations } from '@/test/axe';
import { makeFakeDb } from '@/components/__fixtures__/fakeDb';
import {
  DEPOSIT_ANSWER, errorOutcome, healthBlocked, landlordReady, modelUnavailable, noMatch, unavailable, uploadNeedsConsent,
} from '@/components/__fixtures__/proposals';
import { askNotices, modelGate } from './askNotices';
import { AskScreen } from './index';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));
const db = makeFakeDb('real');
vi.mock('@/index', () => ({ openDb: () => db, getRecord: async () => undefined }));
// The real store's ask reaches this: every question comes back as the error outcome, for the question asked.
const prepareProposal = vi.fn(async (input: PrepareInput): Promise<Proposal> => ({ ...errorOutcome, requestId: input.requestId, question: input.question }));
vi.mock('@/pipeline', () => ({
  composeOutgoingText: (o: StepOption[]) => o.map((x) => x.text).join('\n\n'),
  prepareProposal: (input: PrepareInput) => prepareProposal(input),
}));

const ask = vi.fn(async () => undefined);

/** The store as it starts, with its own ask behind a spy (other tests replace some of its actions). */
function realAsk() {
  const run = vi.fn(useAskReal.getInitialState().ask);
  useAskReal.setState({ ...useAskReal.getInitialState(), ask: run });
  return run;
}

function renderAsk() {
  return render(
    <MemoryRouter>
      <main>
        <AskScreen />
      </main>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.table('sources').clear();
  await db.table('sources').put({ kind: 'folder', connected: true, paused: false, progress: { done: 10, total: 10 } });
  ask.mockClear();
  prepareProposal.mockClear();
  useAskReal.setState({ ask, question: '' });
  useRecords.setState({ ensure: vi.fn(async () => undefined) });
  useSession.setState({ ownerConflict: false });
  useAvailability.setState({ text: 'available', setup: { state: 'idle' } });
  useSettings.setState({ settings: { ...useSettings.getState().settings, cloudFallbackForOwnData: false } });
  useIndexing.setState({ state: 'idle', pausedBy: undefined, left: 0, done: 0, total: 0, etaMs: undefined, activity: undefined, onBattery: false, batteryOverride: false });
});
afterEach(() => {
  act(() => useAskReal.getState().reset());
});

describe('Ask', () => {
  it('idle (F2): the headline, the lead, the prompt card with the ladder and the Nano pill, three chips, the idle hint', async () => {
    renderAsk();
    expect(screen.getByRole('heading', { level: 1, name: 'Ask your own data. Only one line leaves.' })).toBeInTheDocument();
    expect(screen.getByText('Searched and answered on this computer by Gemini Nano. Outside AIs get what you approve, nothing more.')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Ask about your own data' });
    expect(within(card).getByLabelText('What are you looking for?')).toHaveAttribute('placeholder', 'Ask your own data');
    expect(within(card).getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Add a source' })).toBeInTheDocument();
    expect(within(card).getByText('Nano · on this computer')).toBeInTheDocument();
    // The ladder chooses the step before the question; each step says what it sends.
    expect(within(card).getByRole('radiogroup', { name: 'How much may leave' })).toBeInTheDocument();
    expect(within(card).getByRole('radio', { name: 'Answer' })).toHaveAttribute('aria-checked', 'true');
    // what the chosen step lets out is read with the control, and no longer shown beside it
    expect(within(card).getByText('one sentence, written here')).toHaveClass('visually-hidden');
    await userEvent.click(within(card).getByRole('radio', { name: 'Excerpt' }));
    expect(within(card).getByText('the lines that hold the answer, masked')).toBeInTheDocument();
    for (const name of ['How much is my auto insurance this month?', 'How much was my utility bill this month?', 'Did my doctor get back to me about my test?']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(await screen.findByText('Ask a question, or pick an example above. Sieve searches only this device.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a chip runs its question and leaves the box empty; an empty submit shows the inline error', async () => {
    renderAsk();
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByText('Type a question first.')).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'How much is my auto insurance this month?' }));
    expect(ask).toHaveBeenCalledWith('How much is my auto insurance this month?');
    expect(useAskReal.getState().question).toBe('');
    expect(screen.getByLabelText('What are you looking for?')).toHaveValue('');
  });

  it('notices: an empty index, and a model to set up that blocks Ask with its reason', async () => {
    await db.table('sources').clear();
    useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' } });
    renderAsk();
    expect(await screen.findByText('Your private index is empty. Connect Gmail or a folder first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Sources' })).toHaveAttribute('href', '/sources');
    expect(screen.queryByRole('link', { name: 'Try the Playground' })).toBeNull();
    const notice = 'Set up the on-device model once to ask about your own data. It takes about 3 to 4 minutes.';
    expect(screen.getByText(notice)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set it up' })).toHaveAttribute('href', '/prepare?back=/ask');
    const find = screen.getByRole('button', { name: 'Ask' });
    expect(find).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Nano · not set up')).toBeInTheDocument();
    expect(find).toHaveAccessibleDescription(notice);
    await userEvent.type(screen.getByLabelText('What are you looking for?'), 'deposit{Enter}');
    expect(ask).not.toHaveBeenCalled();
    expect(screen.queryByText('Ask a question, or pick an example above. Sieve searches only this device.')).toBeNull();
    await expectNoAxeViolations();
  });

  it('while the model sets up, "Answer when ready" empties the box and runs the question once the model is ready', async () => {
    useAvailability.setState({ text: 'downloadable', setup: { state: 'downloading', fraction: 0.42 } });
    renderAsk();
    expect(screen.getByText("The on-device model is being set up (42%). You can ask once it's ready.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What are you looking for?'), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Answer when ready' }));
    expect(screen.getByText('Sieve answers once the on-device model is ready (42%).')).toBeInTheDocument();
    expect(screen.getByLabelText('What are you looking for?')).toHaveValue('');
    expect(ask).not.toHaveBeenCalled();
    await expectNoAxeViolations();
    act(() => useAvailability.setState({ text: 'available', setup: { state: 'done' } }));
    expect(ask).toHaveBeenCalledWith('deposit');
  });

  it('a chip pressed while the model sets up waits, shown pressed with the box empty, and runs once the model is ready', async () => {
    const run = realAsk();
    useAvailability.setState({ text: 'downloadable', setup: { state: 'downloading', fraction: 0.42 } });
    renderAsk();
    const chip = screen.getByRole('button', { name: 'How much is my auto insurance this month?' });
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('What are you looking for?')).toHaveValue('');
    expect(run).not.toHaveBeenCalled();
    act(() => useAvailability.setState({ text: 'available', setup: { state: 'done' } }));
    expect(run).toHaveBeenCalledWith('How much is my auto insurance this month?');
    expect(await screen.findByText('Something went wrong on this device. Nothing was shared.')).toBeInTheDocument();
    expect(screen.getByText('How much is my auto insurance this month?')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask a follow-up')).toHaveValue('');
  });

  it('no model with cloud fallback off, and on; indexing', () => {
    expect(modelGate({ text: 'no-api', setup: 'idle', cloudFallback: false })).toBe('no-model');
    expect(modelGate({ text: 'no-api', setup: 'idle', cloudFallback: true })).toBe('open');
    const base = { sourcesConnected: true, setup: 'idle' as const, indexing: 'idle' as const, left: 0 };
    const noModel = askNotices({ ...base, text: 'unavailable', cloudFallback: false });
    expect(noModel.map((n) => n.id)).toEqual(['no-model']);
    expect(noModel[0].actions).toEqual([
      { label: 'Set up the on-device model', to: '/prepare?back=/ask' },
      { label: 'Settings', to: '/settings#cloud' },
    ]);
    expect(askNotices({ ...base, sourcesConnected: false, text: 'available', cloudFallback: false })[0].actions).toEqual([{ label: 'Go to Sources', to: '/sources' }]);
    expect(askNotices({ ...base, text: 'unavailable', cloudFallback: true })[0].text).toBe(
      'No on-device model here. Sieve will ask you before the cloud model reads anything, and show you the exact text.',
    );
    expect(askNotices({ ...base, text: 'available', cloudFallback: false, indexing: 'running', left: 1204 })[0].text).toBe(
      "Indexing on this device: 1,204 items left. Answers can miss what isn't indexed yet. Your question goes first.",
    );
    expect(askNotices({ ...base, sourcesConnected: false, text: 'downloadable', cloudFallback: false, indexing: 'running', left: 3 })).toHaveLength(2);
  });

  it('indexing (F2): the indexing card above the examples while it runs, in place of the one-line notice', async () => {
    useIndexing.setState({ state: 'running', left: 1204, done: 296, total: 1500, etaMs: 4 * 60_000 });
    renderAsk();
    const card = await screen.findByRole('region', { name: 'Indexing on this device' });
    expect(within(card).getByRole('progressbar', { name: 'Indexing progress' })).toHaveAttribute('aria-valuetext', '296 of 1,500 items searchable');
    expect(within(card).getByText(/^296 of 1,500 items · about/)).toBeInTheDocument();
    expect(within(card).getByText(/Your questions always go first/)).toBeInTheDocument();
    expect(screen.queryByText(/Indexing on this device: 1,204 items left/)).toBeNull();
    // The card sits above the examples, and the question box is the last of the three.
    const chip = screen.getByRole('button', { name: 'How much is my auto insurance this month?' });
    expect(chip.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const prompt = screen.getByRole('region', { name: 'Ask about your own data' });
    expect(chip.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Ask a question, or pick an example above. Sieve searches only this device.')).toBeNull();
    await expectNoAxeViolations();
    act(() => useIndexing.setState({ state: 'paused', left: 1204 }));
    expect(screen.getByRole('heading', { level: 2, name: 'Indexing paused' })).toBeInTheDocument();
    expect(screen.getByText('Resume to finish the index. 1,204 items left.')).toBeInTheDocument();
    act(() => useIndexing.setState({ state: 'yielding' }));
    expect(screen.getByText('Paused while Sieve answers your question.')).toBeInTheDocument();
  });

  it('indexing on battery: the card says so and its Resume indexes anyway for the session (20 section 13.5)', async () => {
    const user = userEvent.setup();
    useIndexing.setState({ state: 'paused', pausedBy: 'battery', left: 7, done: 2, total: 9, onBattery: true, batteryOverride: false });
    renderAsk();
    const card = await screen.findByRole('region', { name: 'Indexing paused' });
    expect(within(card).getByText('Paused on battery. Plug in, or press Resume to index anyway.')).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(card).getByRole('button', { name: 'Resume' }));
    expect(useIndexing.getState().batteryOverride).toBe(true);
    act(() => useIndexing.setState({ state: 'running', pausedBy: undefined, activity: { stage: 'embed' } }));
    expect(await within(await screen.findByRole('region', { name: 'Indexing on this device' })).findByText('Making the search index')).toBeInTheDocument();
  });

  it('indexing: no card when the index is up to date', async () => {
    renderAsk();
    expect(await screen.findByText('Ask a question, or pick an example above. Sieve searches only this device.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Indexing on this device' })).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Indexing progress' })).toBeNull();
    expect(screen.queryByText('Your index is up to date.')).toBeNull();
  });

  it('preparing: Stop replaces Ask; ready (F3): the question bubble, the gate with the exact text, the follow-up pill', async () => {
    const stop = vi.fn();
    act(() => {
      useAskReal.setState({
        phase: 'preparing', requestId: 'r1', stop, question: 'deposit',
        liveSteps: [{ id: 'r1:1', kind: 'select', label: 'Reading 3 emails on this device…', where: 'device', status: 'running', startedAt: Date.now() }],
      });
    });
    renderAsk();
    expect(screen.getByText('Reading 3 emails on this device…')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Stop' })[0]);
    expect(stop).toHaveBeenCalled();
    await expectNoAxeViolations();
    act(() => useAskReal.setState({ phase: 'ready', proposal: landlordReady, step: 'answer' }));
    expect(screen.getByText(landlordReady.question)).toBeInTheDocument();
    // a chat: the answer alone, with Copy, Open the item and Details under it; the card stays closed until asked for
    expect(screen.getByText(DEPOSIT_ANSWER)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Send this to Gemini in the cloud?' })).toBeNull();
    expect(screen.queryByTestId('outgoing-text')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the item' })).toBeInTheDocument();
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    await expectNoAxeViolations();
    await userEvent.click(details);
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Send this to Gemini in the cloud?' })).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-text').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByLabelText('Ask a follow-up')).toHaveAttribute('placeholder', 'Ask a follow-up about your own data');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByText('Only what you approve leaves your computer. Sieve can make mistakes; the receipt never does.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Might also matter' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('an error: the sentence with Try again under it; the error card only under Details', async () => {
    act(() => useAskReal.setState({ phase: 'error', asked: 'deposit', error: 'Something went wrong on this device. Nothing was shared.' }));
    renderAsk();
    expect(screen.getByText('Something went wrong on this device. Nothing was shared.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ask).toHaveBeenCalledWith('deposit');
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  });
});

/** A finished question, as the store holds it once the pipeline has prepared it: the box is empty again. */
function answered(proposal: Proposal, requestId = proposal.requestId) {
  act(() => useAskReal.setState({ phase: 'ready', requestId, question: '', asked: proposal.question, proposal, step: 'answer' }));
}

const card = () => screen.queryByRole('article', { name: 'Result' });
const details = () => screen.getByRole('button', { name: /^(Details|Hide details)$/ });

describe('Ask as a chat', () => {
  it('keeps the question box in the dock at the bottom of the page, before and after a question', () => {
    renderAsk();
    const dock = () => document.querySelector('main > [data-phase]')?.lastElementChild;
    expect(dock()).toContainElement(screen.getByRole('region', { name: 'Ask about your own data' }));
    expect(dock()).toHaveTextContent('Only what you approve leaves your computer. Sieve can make mistakes; the receipt never does.');
    answered(noMatch);
    expect(dock()).toContainElement(screen.getByLabelText('Ask a follow-up'));
    expect(dock()).toHaveTextContent('Only what you approve leaves your computer. Sieve can make mistakes; the receipt never does.');
    // The conversation starts with the question, then the reply, and the box comes after both.
    const bubble = screen.getByText(noMatch.question);
    const reply = screen.getByText('Nothing on this device matched.');
    expect(bubble.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reply.compareDocumentPosition(screen.getByLabelText('Ask a follow-up')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('every outcome is a plain reply with Details closed; Details shows the card and hides it again', async () => {
    const counts: Proposal = { ...noMatch, requestId: 'req-count', question: 'How many emails did I get?', outcome: 'unsupported' };
    const oneFact: Proposal = {
      ...counts, requestId: 'req-one-fact', question: 'What are my rent and my deposit?',
      options: [unavailable('answer', 'Sieve shares one fact at a time at this level.'), unavailable('excerpt', ''), unavailable('full', '')],
    };
    const cases: [Proposal, string][] = [
      [noMatch, 'Nothing on this device matched.'],
      [healthBlocked, 'Health is never shared.'],
      [counts, "Sieve answers from one item at a time, so counts aren't available."],
      [oneFact, 'Sieve shares one fact at a time at this level.'],
      [modelUnavailable, "The on-device model isn't available."],
    ];
    renderAsk();
    for (const [proposal, sentence] of cases) {
      answered(proposal);
      expect(screen.getByText(sentence)).toBeInTheDocument();
      expect(card()).toBeNull();
      expect(details()).toHaveAttribute('aria-expanded', 'false');
      // nothing to copy and no item to open: a Health item is never opened, even here
      expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open the item' })).toBeNull();
      await userEvent.click(details());
      expect(details()).toHaveAttribute('aria-expanded', 'true');
      expect(card()).toHaveAttribute('data-outcome', proposal.outcome);
      await userEvent.click(details());
      expect(card()).toBeNull();
    }
    await expectNoAxeViolations();
  });

  it('a new question starts with Details closed', async () => {
    renderAsk();
    answered(landlordReady);
    await userEvent.click(details());
    expect(card()).toBeInTheDocument();
    expect(screen.getByText(/^Searched .* picked 1/)).toBeInTheDocument();
    act(() => useAskReal.setState({ phase: 'preparing', requestId: 'r2', proposal: undefined, liveSteps: [] }));
    expect(details()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('preparing-card')).toBeNull();
    answered(landlordReady, 'r2');
    expect(screen.getByText(DEPOSIT_ANSWER)).toBeInTheDocument();
    expect(card()).toBeNull();
    expect(screen.queryByText(/^Searched .* picked 1/)).toBeNull();
  });

  it('while preparing: one quiet line, then the answer as it is written; Details shows the steps', async () => {
    act(() => {
      useAskReal.setState({
        phase: 'preparing', requestId: 'r1', question: 'deposit', answerPreview: '',
        liveSteps: [{ id: 'r1:1', kind: 'retrieve', label: 'Searching this device…', where: 'code', status: 'running', startedAt: Date.now() }],
      });
    });
    renderAsk();
    expect(screen.getByRole('status')).toHaveTextContent('Searching this device…');
    expect(screen.queryByTestId('preparing-card')).toBeNull();
    act(() => useAskReal.setState({ answerPreview: 'Your deposit was' }));
    expect(screen.getByText('Your deposit was')).toBeInTheDocument();
    await userEvent.click(details());
    expect(screen.getByTestId('preparing-card')).toBeInTheDocument();
  });

  it('while preparing, from 3 seconds: how long since the question and what is usual, then why when it is slow (Nov 23)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });   // the clock stands still; timers run as they do
    onTestFinished(() => void vi.useRealTimers());
    act(() => {
      useAskReal.setState({
        phase: 'preparing', requestId: 'r1', question: 'deposit', answerPreview: '', startedAt: Date.now() - 12_000,
        liveSteps: [{ id: 'r1:1', kind: 'select', label: 'Reading 3 emails with the on-device model…', where: 'device', status: 'running', startedAt: Date.now() }],
      });
    });
    renderAsk();
    expect(screen.getByRole('status')).toHaveTextContent('Reading 3 emails with the on-device model…');
    // outside the status line, so the count is not read out every second
    expect(screen.getByTestId('waiting-line')).toHaveTextContent('Asked 12 seconds ago. Answers usually take 20 seconds to a minute.');
    expect(screen.getByRole('status')).not.toHaveTextContent(/Asked/);
    act(() => useAskReal.setState({ startedAt: Date.now() - 70_000 }));
    expect(screen.getByTestId('waiting-line')).toHaveTextContent(
      'Asked 1 min 10 s ago. Answers usually take 20 seconds to a minute. Taking longer than usual. The computer may be busy. Keep the Sieve tab open: it goes on by itself.',
    );
  });

  it('a cloud consent question: the sentence with its two buttons right under it', async () => {
    const allowCloudFor = vi.fn(async () => undefined);
    const reset = vi.fn();
    renderAsk();
    act(() => useAskReal.setState({ allowCloudFor, reset }));
    answered(uploadNeedsConsent);
    expect(screen.getByText('Allow the cloud model to read this item?')).toBeInTheDocument();
    expect(card()).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the item' })).toBeInTheDocument();
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Allow the cloud for this item' }));
    expect(allowCloudFor).toHaveBeenCalledWith('upload:upload-1');
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(reset).toHaveBeenCalled();
  });

  it('a sent question empties the box while the bubble shows it; Try again asks it again and the box stays empty', async () => {
    const run = realAsk();
    renderAsk();
    await userEvent.type(screen.getByLabelText('What are you looking for?'), 'What is my deposit?{Enter}');
    expect(await screen.findByText('Something went wrong on this device. Nothing was shared.')).toBeInTheDocument();
    expect(screen.getByText('What is my deposit?')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask a follow-up')).toHaveValue('');
    expect(useAskReal.getState()).toMatchObject({ question: '', asked: 'What is my deposit?' });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(run).toHaveBeenLastCalledWith('What is my deposit?');
    await vi.waitFor(() => expect(prepareProposal).toHaveBeenCalledTimes(2));
    expect(prepareProposal.mock.calls.map((c) => c[0].question)).toEqual(['What is my deposit?', 'What is my deposit?']);
    expect(await screen.findByText('Something went wrong on this device. Nothing was shared.')).toBeInTheDocument();
    expect(screen.getByText('What is my deposit?')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask a follow-up')).toHaveValue('');
  });

  it('a follow-up empties the box too; Try again asks the question asked, not what is typed below it', async () => {
    const run = realAsk();
    renderAsk();
    answered(errorOutcome);
    const box = screen.getByLabelText('Ask a follow-up');
    await userEvent.type(box, 'Where is my lease?{Enter}');
    expect(run).toHaveBeenLastCalledWith('Where is my lease?');
    expect(box).toHaveValue('');
    expect(await screen.findByText('Where is my lease?')).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Try again' });
    await userEvent.type(screen.getByLabelText('Ask a follow-up'), 'half a question');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(run).toHaveBeenLastCalledWith('Where is my lease?');
    expect(screen.getByLabelText('Ask a follow-up')).toHaveValue('half a question');
  });

  it('Stop while the answer is prepared: back to the empty box, nothing put back', async () => {
    prepareProposal.mockImplementationOnce(
      (input: PrepareInput) =>
        new Promise((resolve) => {
          input.signal?.addEventListener('abort', () => resolve({ ...errorOutcome, requestId: input.requestId, question: input.question }));
        }),
    );
    realAsk();
    renderAsk();
    await userEvent.type(screen.getByLabelText('What are you looking for?'), 'What is my deposit?{Enter}');
    await vi.waitFor(() => expect(prepareProposal).toHaveBeenCalled());
    expect(screen.getByLabelText('Ask a follow-up')).toHaveValue('');
    await userEvent.click(screen.getAllByRole('button', { name: 'Stop' })[0]);
    expect(await screen.findByLabelText('What are you looking for?')).toHaveValue('');
    expect(useAskReal.getState()).toMatchObject({ phase: 'idle', question: '' });
  });

  it('an error outcome: the sentence with Try again', async () => {
    renderAsk();
    answered(errorOutcome);
    expect(screen.getByText('Something went wrong on this device. Nothing was shared.')).toBeInTheDocument();
    expect(card()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ask).toHaveBeenCalledWith(errorOutcome.question);
  });

  it('only a notice that blocks asking stays in view; the others show with Details', async () => {
    await db.table('sources').clear();
    useIndexing.setState({ state: 'running', left: 12 });
    renderAsk();
    answered(noMatch);
    await userEvent.click(details());
    expect(await screen.findByText('Your private index is empty. Connect Gmail or a folder first.')).toBeInTheDocument();
    expect(screen.getByText(/^Indexing on this device: 12 items left/)).toBeInTheDocument();
    await userEvent.click(details());
    expect(screen.queryByText('Your private index is empty. Connect Gmail or a folder first.')).toBeNull();
    expect(screen.queryByText(/^Indexing on this device/)).toBeNull();
    act(() => useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' } }));
    const blocking = 'Set up the on-device model once to ask about your own data. It takes about 3 to 4 minutes.';
    expect(screen.getByText(blocking)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAccessibleDescription(blocking);
    await expectNoAxeViolations();
  });
});
