import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { DraftPanel, type DraftPanelProps } from './DraftPanel';

const base: DraftPanelProps = {
  instruction: 'Draft a short, polite reply.',
  onInstructionChange: () => undefined,
  phase: 'ready',
  onRetry: () => undefined,
  stepPhrase: 'the answer',
  onSeeReceipts: () => undefined,
  onAskAgain: () => undefined,
};
const shared = { kind: 'shared' as const, receiptId: 'r1', chars: 69, step: 'answer' as const, itemCount: 1 };

describe('DraftPanel', () => {
  it('before the decision: the instruction field with its help and a 200 character limit', async () => {
    const onInstructionChange = vi.fn();
    render(<main><DraftPanel {...base} onInstructionChange={onInstructionChange} /></main>);
    const field = screen.getByLabelText('Instruction for the cloud model');
    expect(field).toHaveValue('Draft a short, polite reply.');
    expect(field).toHaveAttribute('maxlength', '200');
    expect(field).toHaveAccessibleDescription('Sent with the text above. Keep personal details out of it.');
    await userEvent.type(field, '!');
    expect(onInstructionChange).toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it('drafting: the cloud tag and the drafting line', async () => {
    render(<main><DraftPanel {...base} phase="drafting" outcome={shared} /></main>);
    expect(screen.getByText('Gemini is drafting in the cloud…')).toBeInTheDocument();
    expect(screen.getByText('Cloud · Gemini')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('done: the draft, Copy draft, the note and the receipt line', async () => {
    const onSeeReceipts = vi.fn();
    const draft = 'Hi, thanks for confirming the deposit.';
    render(<main><DraftPanel {...base} phase="done" outcome={shared} draft={draft} onSeeReceipts={onSeeReceipts} /></main>);
    expect(screen.getByRole('heading', { name: 'Draft from the cloud model' })).toBeInTheDocument();
    expect(screen.getByTestId('draft-text').textContent).toBe(draft);
    expect(screen.getByRole('button', { name: 'Copy draft' })).toBeInTheDocument();
    expect(screen.getByText(/Gemini saw only/).textContent).toBe('Gemini saw only the answer and your instruction: 69 characters.');
    expect(screen.getByText(/Sent only the answer/)).toHaveTextContent('Sent only the answer to the cloud model. A receipt was saved.');
    await userEvent.click(screen.getByRole('button', { name: 'See what AI has seen' }));
    expect(onSeeReceipts).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('done with an error: the warning and Try again, and the receipt line still shows', async () => {
    const onRetry = vi.fn();
    render(<main><DraftPanel {...base} phase="done" outcome={shared} draftError="The cloud model is busy right now. Try again in a minute." onRetry={onRetry} /></main>);
    expect(screen.getByText('The cloud model is busy right now. Try again in a minute.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText(/A receipt was saved/)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('kept local: the line and Ask something else', async () => {
    const onAskAgain = vi.fn();
    render(<main><DraftPanel {...base} phase="done" outcome={{ kind: 'kept-local' }} onAskAgain={onAskAgain} /></main>);
    expect(screen.getByText('Kept on this device. Nothing was shared.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ask something else' }));
    expect(onAskAgain).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });
});
