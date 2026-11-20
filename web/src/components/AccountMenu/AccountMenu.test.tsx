import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { ACCOUNT } from '@/copy/strings';
import { useSession } from '@/state/session';
import { AccountMenu } from './AccountMenu';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));

function renderMenu() {
  return render(
    <MemoryRouter>
      <main>
        <AccountMenu />
      </main>
    </MemoryRouter>,
  );
}

describe('AccountMenu', () => {
  beforeEach(() => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'mani@example.com', displayName: 'Mani', isAnonymous: false } });
  });

  it('shows the first letter and opens a menu with the account items', async () => {
    const user = userEvent.setup();
    renderMenu();
    const button = screen.getByRole('button', { name: ACCOUNT.button });
    expect(button).toHaveTextContent('M');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(ACCOUNT.signedInAs('mani@example.com'))).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([ACCOUNT.settings, ACCOUNT.playground, ACCOUNT.signOut]);
    expect(items[0]).toHaveFocus();
    await expectNoAxeViolations();
  });

  it('moves with the arrow keys and returns focus on Escape', async () => {
    const user = userEvent.setup();
    renderMenu();
    const button = screen.getByRole('button', { name: ACCOUNT.button });
    await user.click(button);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: ACCOUNT.playground })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: ACCOUNT.signOut })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('signs out from the menu', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => undefined);
    useSession.setState({ signOut });
    renderMenu();
    await user.click(screen.getByRole('button', { name: ACCOUNT.button }));
    await user.click(screen.getByRole('menuitem', { name: ACCOUNT.signOut }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});
