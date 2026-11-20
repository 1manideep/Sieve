import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

  it('done: the receipt chip, the draft under its heading, Copy the draft, New ask and the note', async () => {
    const onSeeReceipts = vi.fn();
    const onAskAgain = vi.fn();
    const draft = 'Hi, thanks for confirming the deposit.';
    render(<main><DraftPanel {...base} phase="done" outcome={{ ...shared, receiptId: 'rcpt-0412' }} draft={draft} onSeeReceipts={onSeeReceipts} onAskAgain={onAskAgain} /></main>);
    expect(screen.getByText('sent 69 characters to Gemini · receipt #0412')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gemini drafted a reply from those 69 characters alone' })).toBeInTheDocument();
    expect(screen.getByTestId('draft-text').textContent).toBe(draft);
    expect(screen.getByRole('button', { name: 'Copy the draft' })).toBeInTheDocument();
    expect(screen.getByText(/Gemini saw only/).textContent).toBe('Gemini saw only the answer and your instruction: 69 characters.');
    await userEvent.click(screen.getByRole('button', { name: 'open this receipt in What has AI seen?' }));
    expect(onSeeReceipts).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'New ask' }));
    expect(onAskAgain).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('real data: the receipt chip opens What has AI seen? as a link', () => {
    render(<MemoryRouter><main><DraftPanel {...base} phase="done" outcome={shared} draft="Hi." receiptsHref="/seen" /></main></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'open this receipt in What has AI seen?' })).toHaveAttribute('href', '/seen');
  });

  it('done with an error: the warning and Try again, and the receipt line still shows', async () => {
    const onRetry = vi.fn();
    render(<main><DraftPanel {...base} phase="done" outcome={shared} draftError="The cloud model is busy right now. Try again in a minute." onRetry={onRetry} /></main>);
    expect(screen.getByText('The cloud model is busy right now. Try again in a minute.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText('sent 69 characters to Gemini · receipt #r1')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('kept local: the line and New ask', async () => {
    const onAskAgain = vi.fn();
    render(<main><DraftPanel {...base} phase="done" outcome={{ kind: 'kept-local' }} onAskAgain={onAskAgain} /></main>);
    expect(screen.getByText('Kept on this device. Nothing was shared.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New ask' }));
    expect(onAskAgain).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });
});
