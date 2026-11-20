import { act, render, screen } from '@testing-library/react';
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
  useIndexing.setState({ state: 'idle', left: 0 });
});
afterEach(() => {
  act(() => useAskReal.getState().reset());
});

describe('Ask', () => {
  it('idle: header, question card, three example chips and the idle hint', async () => {
    renderAsk();
    expect(screen.getByRole('heading', { level: 1, name: 'Ask your own data' })).toBeInTheDocument();
    expect(screen.getByLabelText('What are you looking for?')).toHaveAttribute('placeholder', "e.g. my landlord's email about the deposit");
    expect(screen.getByRole('button', { name: 'Find on this device' })).toBeInTheDocument();
    for (const name of ["Landlord's email about the deposit", 'The photo with five hot dogs in my mouth', 'What does my lease say about pets?']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(await screen.findByText('Ask a question, or pick an example above. Sieve searches only this device.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a chip sets the question and runs it; an empty submit shows the inline error', async () => {
    renderAsk();
    await userEvent.click(screen.getByRole('button', { name: 'Find on this device' }));
    expect(screen.getByText('Type a question first.')).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: "Landlord's email about the deposit" }));
    expect(ask).toHaveBeenCalledWith('What did my landlord say about the deposit? Draft a reply.');
    expect(useAskReal.getState().question).toBe('What did my landlord say about the deposit? Draft a reply.');
    expect(screen.getByRole('button', { name: "Landlord's email about the deposit" })).toHaveAttribute('aria-pressed', 'true');
  });

  it('notices: an empty index, and a model to set up that blocks Find with its reason', async () => {
    await db.table('sources').clear();
    useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' } });
    renderAsk();
    expect(await screen.findByText('Your private index is empty. Connect Gmail or a folder first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Sources' })).toHaveAttribute('href', '/sources');
    const notice = 'Set up the on-device model once to ask about your own data. It takes about 3 to 4 minutes.';
    expect(screen.getByText(notice)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set it up' })).toHaveAttribute('href', '/prepare?back=/');
    const find = screen.getByRole('button', { name: 'Find on this device' });
    expect(find).toHaveAttribute('aria-disabled', 'true');
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
    expect(askNotices({ ...base, text: 'unavailable', cloudFallback: false }).map((n) => n.id)).toEqual(['no-model']);
    expect(askNotices({ ...base, text: 'unavailable', cloudFallback: true })[0].text).toBe(
      'No on-device model here. Sieve will ask you before the cloud model reads anything, and show you the exact text.',
    );
    expect(askNotices({ ...base, text: 'available', cloudFallback: false, indexing: 'running', left: 1204 })[0].text).toBe(
      "Indexing on this device: 1,204 items left. Answers can miss what isn't indexed yet. Your question goes first.",
    );
    expect(askNotices({ ...base, sourcesConnected: false, text: 'downloadable', cloudFallback: false, indexing: 'running', left: 3 })).toHaveLength(2);
  });

  it('preparing: Stop replaces Find; ready: the approval card with the exact text', async () => {
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
    expect(screen.getByTestId('outgoing-text').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByRole('button', { name: 'Find on this device' })).toBeInTheDocument();
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
