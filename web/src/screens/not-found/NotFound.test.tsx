// Not found (40 section 13.10): H1, one line and Open Sieve, which goes to Ask for a Google user; everyone else signs
// in with Google. Nothing links to the Playground.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ROUTE_ERROR, SCREENS } from '@/copy/strings';
import { useSession } from '@/state/session';
import { expectNoAxeViolations } from '@/test/axe';
import { Component } from './index';

function renderNotFound() {
  const router = createMemoryRouter(
    [{ path: '/ask', element: <p>Ask page</p> }, { path: '*', element: <main><Component /></main> }],
    { initialEntries: ['/nowhere'] },
  );
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  useSession.setState({ kind: 'none', user: null });
});

describe('Not found', () => {
  it('sends a Google user to Ask', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u', email: 'person@example.com', isAnonymous: false } });
    renderNotFound();
    expect(document.title).toBe('Not found · Sieve');
    expect(screen.getByRole('heading', { level: 1, name: SCREENS.notFound.heading })).toBeInTheDocument();
    expect(screen.getByText(ROUTE_ERROR.notFoundLine)).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: ROUTE_ERROR.openSieve })).toHaveAttribute('href', '/ask');
    await expectNoAxeViolations();
  });

  it('everyone else signs in with Google, then goes to Ask', async () => {
    const signInWithGoogle = vi.fn(async () => {
      useSession.setState({ kind: 'google', user: { uid: 'u', email: 'person@example.com', isAnonymous: false } });
      return 'ok' as const;
    });
    useSession.setState({ kind: 'anonymous', user: { uid: 'a', isAnonymous: true }, signInWithGoogle });
    renderNotFound();
    expect(screen.queryByRole('link')).toBeNull();
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: ROUTE_ERROR.openSieve }));
    expect(signInWithGoogle).toHaveBeenCalledOnce();
    expect(await screen.findByText('Ask page')).toBeInTheDocument();
  });
});
