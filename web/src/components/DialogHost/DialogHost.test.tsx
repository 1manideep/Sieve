import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/state/session';
import { expectNoAxeViolations } from '@/test/axe';
import { DialogHost } from './DialogHost';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));

afterEach(() => {
  useSession.setState({ ownerConflict: false, kind: 'none', user: null });
});

describe('DialogHost', () => {
  it('shows nothing without an owner conflict', () => {
    render(<DialogHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks with the owner-check dialog until the person clears the index or signs out', async () => {
    const resolveOwnerConflict = vi.fn(async () => undefined);
    act(() => {
      useSession.setState({
        kind: 'google',
        ownerConflict: true,
        user: { uid: 'u2', email: 'b@example.com', isAnonymous: false },
        resolveOwnerConflict,
      });
    });
    render(<main><DialogHost /></main>);
    const dialog = screen.getByRole('dialog', { name: "This browser holds another account's index" });
    expect(dialog).toHaveAccessibleDescription(
      "Sieve's private index on this computer belongs to a different Google account. Clear it to use Sieve as b@example.com, or sign out.",
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Clear it and continue' }));
    expect(resolveOwnerConflict).toHaveBeenCalledWith('clear');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(resolveOwnerConflict).toHaveBeenCalledWith('sign-out');
  });
});
