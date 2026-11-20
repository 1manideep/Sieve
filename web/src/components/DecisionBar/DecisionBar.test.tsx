import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { DecisionBar } from './DecisionBar';

describe('DecisionBar', () => {
  it('in-app: "Use it here, share nothing" and "Draft a reply with the cloud model"', async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(<main><DecisionBar variant="in-app" canApprove onApprove={onApprove} onDeny={onDeny} /></main>);
    await userEvent.click(screen.getByRole('button', { name: 'Draft a reply with the cloud model' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use it here, share nothing' }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onDeny).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('relay: "Approve and send" and "Deny"', () => {
    render(<DecisionBar variant="relay" canApprove onApprove={() => undefined} onDeny={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it.each([
    "You're offline. Drafting needs the cloud model.",
    "You're offline. Sieve can send this when you're back online.",
    'This is more than Sieve sends at once (8,000 characters). Untick an item or pick a lower step.',
    "This step isn't available.",
    'Wait for the ticked items to be ready.',
  ])('a blocked approve stays focusable with aria-disabled and describes "%s"', async (reason) => {
    const onApprove = vi.fn();
    render(<main><DecisionBar variant="in-app" canApprove={false} approveBlockedReason={reason} onApprove={onApprove} onDeny={() => undefined} /></main>);
    const approve = screen.getByRole('button', { name: 'Draft a reply with the cloud model' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).not.toBeDisabled();
    expect(approve).toHaveAccessibleDescription(reason);
    await userEvent.click(approve);
    expect(onApprove).not.toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it('shows a spinner on the busy button and blocks both', async () => {
    const onDeny = vi.fn();
    render(<DecisionBar variant="relay" canApprove busy="approve" onApprove={() => undefined} onDeny={onDeny} />);
    expect(screen.getByRole('button', { name: 'Approve and send' })).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).not.toHaveBeenCalled();
  });
});
