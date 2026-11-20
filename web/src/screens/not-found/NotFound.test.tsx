// Not found (40 section 13.10): H1, one line and Open Sieve, which goes to Ask for a Google user, else the Playground.
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ROUTE_ERROR, SCREENS } from '@/copy/strings';
import { useSession } from '@/state/session';
import { expectNoAxeViolations } from '@/test/axe';
import { Component } from './index';

function renderNotFound() {
  const router = createMemoryRouter([{ path: '*', element: <main><Component /></main> }], { initialEntries: ['/nowhere'] });
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
    expect(screen.getByRole('link', { name: ROUTE_ERROR.openSieve })).toHaveAttribute('href', '/');
    await expectNoAxeViolations();
  });

  it('sends everyone else to the Playground', async () => {
    useSession.setState({ kind: 'anonymous', user: { uid: 'a', isAnonymous: true } });
    renderNotFound();
    expect(screen.getByRole('link', { name: ROUTE_ERROR.openSieve })).toHaveAttribute('href', '/playground');
    await expectNoAxeViolations();
  });
});
