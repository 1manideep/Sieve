import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { NAV } from '@/copy/strings';
import { useHomeBase } from '@/state/homeBase';
import { useSession } from '@/state/session';
import { MainLayout } from './MainLayout';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));

function renderLayout(path: string) {
  const router = createMemoryRouter(
    [{ element: <MainLayout />, children: [{ path: '*', element: <h1>Screen</h1> }] }],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

const EXPECTED_LINKS = [
  [NAV.ask, '/'],
  [NAV.requests, '/requests'],
  [NAV.sources, '/sources'],
  [NAV.seen, '/seen'],
  [NAV.settings, '/settings'],
] as const;

describe('MainLayout', () => {
  afterEach(() => {
    useHomeBase.getState().reset();
  });

  it('renders the main nav links in order, with the active one marked', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'mani@example.com', isAnonymous: false } });
    renderLayout('/sources');
    const nav = screen.getByRole('navigation', { name: NAV.label });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual(EXPECTED_LINKS.map(([n, h]) => [n, h]));
    expect(within(nav).getByRole('link', { name: NAV.sources })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: NAV.ask })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: NAV.playground })).toHaveAttribute('href', '/playground');
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Status: / })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    await expectNoAxeViolations();
  });

  it('names the Requests link with the waiting count', async () => {
    useHomeBase.setState({ awaitingCount: 2 });
    renderLayout('/');
    expect(screen.getByRole('link', { name: NAV.requestsWaiting(2) })).toHaveAttribute('href', '/requests');
    await expectNoAxeViolations();
  });

  it('hides the nav and the Playground button on /setup', async () => {
    renderLayout('/setup');
    expect(screen.queryByRole('navigation', { name: NAV.label })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: NAV.playground })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
