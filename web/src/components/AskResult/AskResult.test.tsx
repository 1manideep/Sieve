import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepOption } from '@sieve/shared';
import { createAskStore } from '@/state/ask';
import { useRecords } from '@/state/records';
import { expectNoAxeViolations } from '@/test/axe';
import { DEPOSIT_ANSWER, landlordReady, noMatch, traceSteps } from '../__fixtures__/proposals';
import { AskResult, likelyMatches, searchedLine } from './AskResult';

vi.mock('@/index', () => ({ openDb: () => ({}), getRecord: async () => undefined }));

const compose = (o: StepOption[]) => o.map((x) => x.text).join('\n\n');
const useAsk = createAskStore('playground');

function renderResult(online = true) {
  return render(
    <MemoryRouter>
      <main>
        <AskResult useAsk={useAsk} variant="playground" dbKind="playground" compose={compose} online={online} onSeeReceipts={vi.fn()} onAskAgain={vi.fn()} idle={<p>Pick a question</p>} sampleData />
      </main>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useRecords.setState({ ensure: vi.fn(async () => undefined) });
});
afterEach(() => {
  act(() => useAsk.getState().reset());
});

describe('AskResult', () => {
  it('idle: the idle hint', async () => {
    renderResult();
    expect(screen.getByText('Pick a question')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('preparing: the live trace and the streamed answer; Stop stops', async () => {
    const stop = vi.fn();
    act(() => {
      useAsk.setState({
        phase: 'preparing', requestId: 'r1', stop,
        liveSteps: [{ id: 'r1:1', kind: 'retrieve', label: 'Searching this device…', where: 'code', status: 'running', startedAt: Date.now() }],
        answerPreview: 'Your deposit',
      });
    });
    renderResult();
    expect(screen.getByText('Searching this device…')).toBeInTheDocument();
    expect(screen.getByTestId('streamed-answer').textContent).toBe('Your deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stop).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('ready: the approval card with the exact text; approving drafts, the draft and the receipt line follow', async () => {
    const approveAndDraft = vi.fn(async () => {
      useAsk.setState({
        phase: 'done', draft: 'Hi, thanks for confirming the deposit.',
        outcome: { kind: 'shared', receiptId: 'rc1', chars: 69, step: 'answer', itemCount: 1 },
        extraTrace: [traceSteps.approve(), traceSteps.draft(69)],
      });
    });
    act(() => {
      useAsk.setState({ phase: 'ready', requestId: 'r1', proposal: landlordReady, step: 'answer', approveAndDraft });
    });
    renderResult();
    // F3: the question as a bubble, the searched line, the item chip, the answer and the gate with the exact text.
    expect(screen.getByText(landlordReady.question)).toBeInTheDocument();
    expect(screen.getByText('Searched this computer · picked 1')).toBeInTheDocument();
    expect(screen.getByTestId('answer-headline').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByRole('heading', { name: 'Send this to Gemini in the cloud?' })).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-text').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByLabelText('Instruction for the cloud model')).toHaveValue('Draft a short, polite reply.');
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: `Approve, ${DEPOSIT_ANSWER.length + 'Draft a short, polite reply.'.length} characters` }));
    expect(approveAndDraft).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Gemini drafted a reply from those 69 characters alone' })).toBeInTheDocument();
    expect(screen.getByTestId('trace-total')).toHaveTextContent('69 characters left this device');
    expect(screen.getByText('sent 69 characters to Gemini · receipt #rc1').closest('p')).toHaveFocus();
    await expectNoAxeViolations();
  });

  it('offline: approving is blocked with its reason', () => {
    act(() => {
      useAsk.setState({ phase: 'ready', requestId: 'r1', proposal: landlordReady, step: 'answer' });
    });
    renderResult(false);
    expect(screen.getByRole('button', { name: /^Approve, [\d,]+ characters$/ })).toHaveAccessibleDescription("You're offline. Drafting needs the cloud model.");
  });

  it('keep local: "Keep it here" keeps it on the device', async () => {
    const keepLocal = vi.fn(() => useAsk.setState({ phase: 'done', outcome: { kind: 'kept-local' } }));
    act(() => {
      useAsk.setState({ phase: 'ready', requestId: 'r1', proposal: landlordReady, step: 'answer', keepLocal });
    });
    renderResult();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it here' }));
    expect(keepLocal).toHaveBeenCalledOnce();
    expect(await screen.findByText('Kept on this device. Nothing was shared.')).toHaveFocus();
  });

  it('error: "Sieve took too long" for the timeout, and Try again asks again', async () => {
    const ask = vi.fn(async () => undefined);
    act(() => {
      useAsk.setState({ phase: 'error', error: 'Sieve took too long on this device. Nothing was shared.', ask });
    });
    renderResult();
    expect(screen.getByRole('heading', { name: 'Sieve took too long' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ask).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('without chat (the Playground): the card at once for every outcome, with no reply line and no Details', () => {
    act(() => {
      useAsk.setState({ phase: 'ready', requestId: 'r1', proposal: noMatch, step: 'answer' });
    });
    renderResult();
    expect(screen.getByRole('article', { name: 'Result' })).toHaveAttribute('data-outcome', 'no-match');
    expect(screen.getByText('Nothing on this device matched')).toBeInTheDocument();
    expect(screen.queryByText('Nothing on this device matched.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
  });

  it('the searched line uses real numbers only: the index size and the items a model read', () => {
    expect(likelyMatches(landlordReady.trace)).toBe(3);
    expect(searchedLine(46, 1)).toBe('Searched 46 items on this computer · picked 1 · the other 45 were never read by a model');
    expect(searchedLine(46, 3)).toBe('Searched 46 items on this computer · picked 1 · 43 were never read by a model');
    expect(searchedLine(2, 1)).toBe('Searched 2 items on this computer · picked 1 · the other one was never read by a model');
    expect(searchedLine(1204, undefined)).toBe('Searched 1,204 items on this computer · picked 1');
    expect(searchedLine(undefined, 3)).toBe('Searched this computer · picked 1');
  });
});
