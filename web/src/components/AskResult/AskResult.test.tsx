import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepOption } from '@sieve/shared';
import { createAskStore } from '@/state/ask';
import { useRecords } from '@/state/records';
import { expectNoAxeViolations } from '@/test/axe';
import { DEPOSIT_ANSWER, landlordReady, traceSteps } from '../__fixtures__/proposals';
import { AskResult } from './AskResult';

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
    expect(screen.getByTestId('outgoing-text').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByLabelText('Instruction for the cloud model')).toHaveValue('Draft a short, polite reply.');
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Draft a reply with the cloud model' }));
    expect(approveAndDraft).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Draft from the cloud model' })).toBeInTheDocument();
    expect(screen.getByTestId('trace-total')).toHaveTextContent('69 characters left this device');
    expect(screen.getByText(/Sent only the answer to the cloud model/)).toHaveFocus();
    await expectNoAxeViolations();
  });

  it('offline: approving is blocked with its reason', () => {
    act(() => {
      useAsk.setState({ phase: 'ready', requestId: 'r1', proposal: landlordReady, step: 'answer' });
    });
    renderResult(false);
    expect(screen.getByRole('button', { name: 'Draft a reply with the cloud model' })).toHaveAccessibleDescription("You're offline. Drafting needs the cloud model.");
  });

  it('keep local: "Use it here, share nothing" keeps it on the device', async () => {
    const keepLocal = vi.fn(() => useAsk.setState({ phase: 'done', outcome: { kind: 'kept-local' } }));
    act(() => {
      useAsk.setState({ phase: 'ready', requestId: 'r1', proposal: landlordReady, step: 'answer', keepLocal });
    });
    renderResult();
    await userEvent.click(screen.getByRole('button', { name: 'Use it here, share nothing' }));
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
});
