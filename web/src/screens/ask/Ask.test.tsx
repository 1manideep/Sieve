import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepOption } from '@sieve/shared';
import { useAskReal } from '@/state/ask';
import { useAvailability } from '@/state/availability';
import { useIndexing } from '@/state/indexing';
import { useRecords } from '@/state/records';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { expectNoAxeViolations } from '@/test/axe';
import { makeFakeDb } from '@/components/__fixtures__/fakeDb';
import { DEPOSIT_ANSWER, landlordReady } from '@/components/__fixtures__/proposals';
import { askNotices, modelGate } from './askNotices';
import { AskScreen } from './index';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));
const db = makeFakeDb('real');
vi.mock('@/index', () => ({ openDb: () => db, getRecord: async () => undefined }));
vi.mock('@/pipeline', () => ({ composeOutgoingText: (o: StepOption[]) => o.map((x) => x.text).join('\n\n') }));

const ask = vi.fn(async () => undefined);

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
    expect(within(card).getByLabelText('What are you looking for?')).toHaveAttribute('placeholder', "e.g. my landlord's email about the deposit");
    expect(within(card).getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Add a source' })).toBeInTheDocument();
    expect(within(card).getByText('Nano · on this computer')).toBeInTheDocument();
    // The ladder chooses the step before the question; each step says what it sends.
    expect(within(card).getByRole('radiogroup', { name: 'How much may leave' })).toBeInTheDocument();
    expect(within(card).getByRole('radio', { name: 'Answer' })).toHaveAttribute('aria-checked', 'true');
    expect(within(card).getByText('one sentence, written here')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('radio', { name: 'Excerpt' }));
    expect(within(card).getByText('the lines that hold the answer, masked')).toBeInTheDocument();
    for (const name of ["Landlord's email about the deposit", 'The photo with five hot dogs in my mouth', 'What does my lease say about pets?']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(await screen.findByText('Ask a question, or pick an example above. Sieve searches only this device.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a chip sets the question and runs it; an empty submit shows the inline error', async () => {
    renderAsk();
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByText('Type a question first.')).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: "Landlord's email about the deposit" }));
    expect(ask).toHaveBeenCalledWith('What did my landlord say about the deposit? Draft a reply.');
    expect(useAskReal.getState().question).toBe('What did my landlord say about the deposit? Draft a reply.');
    expect(screen.getByRole('button', { name: "Landlord's email about the deposit" })).toHaveAttribute('aria-pressed', 'true');
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

  it('while the model sets up, "Answer when ready" keeps the question and runs it once the model is ready', async () => {
    useAvailability.setState({ text: 'downloadable', setup: { state: 'downloading', fraction: 0.42 } });
    renderAsk();
    expect(screen.getByText("The on-device model is being set up (42%). You can ask once it's ready.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What are you looking for?'), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Answer when ready' }));
    expect(screen.getByText('Sieve answers once the on-device model is ready (42%).')).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    await expectNoAxeViolations();
    act(() => useAvailability.setState({ text: 'available', setup: { state: 'done' } }));
    expect(ask).toHaveBeenCalledWith('deposit');
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

  it('indexing (F2): the indexing card under the chips while it runs, in place of the one-line notice', async () => {
    useIndexing.setState({ state: 'running', left: 1204, done: 296, total: 1500, etaMs: 4 * 60_000 });
    renderAsk();
    const card = await screen.findByRole('region', { name: 'Indexing on this device' });
    expect(within(card).getByRole('progressbar', { name: 'Indexing progress' })).toHaveAttribute('aria-valuetext', 'Indexing 296 of 1,500 items');
    expect(within(card).getByText(/^296 of 1,500 items · about/)).toBeInTheDocument();
    expect(within(card).getByText(/Your questions always go first/)).toBeInTheDocument();
    expect(screen.queryByText(/Indexing on this device: 1,204 items left/)).toBeNull();
    // The card sits after the chips, inside the home.
    const chip = screen.getByRole('button', { name: "Landlord's email about the deposit" });
    expect(chip.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.getByRole('heading', { name: 'Send this to Gemini in the cloud?' })).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-text').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByLabelText('Ask a follow-up')).toHaveAttribute('placeholder', 'Ask a follow-up about your own data');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByText('Only what you approve leaves your computer. Sieve can make mistakes; the receipt never does.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Might also matter' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('an error card with Try again', async () => {
    act(() => useAskReal.setState({ phase: 'error', error: 'Something went wrong on this device. Nothing was shared.' }));
    renderAsk();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ask).toHaveBeenCalled();
    await expectNoAxeViolations();
  });
});
