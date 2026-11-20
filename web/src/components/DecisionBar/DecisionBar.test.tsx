import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { DecisionBar } from './DecisionBar';

describe('DecisionBar', () => {
  it('in-app: "Approve, N characters" (blue) then "Keep it here", and the mono note', async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(<main><DecisionBar variant="in-app" canApprove onApprove={onApprove} onDeny={onDeny} chars={1234} note="1,234 characters · No personal details found" /></main>);
    const approve = screen.getByRole('button', { name: 'Approve, 1,234 characters' });
    const keep = screen.getByRole('button', { name: 'Keep it here' });
    expect(approve.compareDocumentPosition(keep)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("1,234 characters · No personal details found")).toBeInTheDocument();
    await userEvent.click(approve);
    await userEvent.click(keep);
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onDeny).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('relay: "Approve, N characters" and "Decline"; without a count, "Approve and send"', () => {
    const { rerender } = render(<DecisionBar variant="relay" canApprove onApprove={() => undefined} onDeny={() => undefined} chars={41} />);
    expect(screen.getByRole('button', { name: 'Approve, 41 characters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    rerender(<DecisionBar variant="relay" canApprove onApprove={() => undefined} onDeny={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeInTheDocument();
  });

  it('in-app without a count: "Approve"', () => {
    render(<DecisionBar variant="in-app" canApprove onApprove={() => undefined} onDeny={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it.each([
    "You're offline. Drafting needs the cloud model.",
    "You're offline. Sieve can send this when you're back online.",
    'This is more than Sieve sends at once (8,000 characters). Untick an item or pick a lower step.',
    "This step isn't available.",
    'Wait for the ticked items to be ready.',
  ])('a blocked approve stays focusable with aria-disabled and describes "%s"', async (reason) => {
    const onApprove = vi.fn();
    render(<main><DecisionBar variant="in-app" canApprove={false} approveBlockedReason={reason} onApprove={onApprove} onDeny={() => undefined} chars={41} /></main>);
    const approve = screen.getByRole('button', { name: 'Approve, 41 characters' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).not.toBeDisabled();
    expect(approve).toHaveAccessibleDescription(reason);
    await userEvent.click(approve);
    expect(onApprove).not.toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it('shows a spinner on the busy button and blocks both', async () => {
    const onDeny = vi.fn();
    render(<DecisionBar variant="relay" canApprove busy="approve" onApprove={() => undefined} onDeny={onDeny} chars={41} />);
    expect(screen.getByRole('button', { name: 'Approve, 41 characters' })).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDeny).not.toHaveBeenCalled();
  });
});
