import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { NAV, RAIL } from '@/copy/strings';
import { useAvailability } from '@/state/availability';
import { useHomeBase } from '@/state/homeBase';
import { useIndexing } from '@/state/indexing';
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
  [NAV.newAsk, '/'],
  [NAV.tryComputer, '/try'],
  [NAV.requests, '/requests'],
  [NAV.seen, '/seen'],
  [NAV.sources, '/sources'],
  [NAV.settings, '/settings'],
] as const;

describe('MainLayout', () => {
  afterEach(() => {
    useHomeBase.getState().reset();
    useAvailability.setState({ text: 'checking', image: 'checking', setup: { state: 'idle' } });
    useIndexing.setState({ state: 'idle', left: 0, done: 0, total: 0, etaMs: undefined });
  });

  it('renders the rail links in order, with the active one marked', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'mani@example.com', isAnonymous: false } });
    renderLayout('/sources');
    expect(screen.getByRole('link', { name: 'Sieve' })).toHaveAttribute('href', '/');
    const nav = screen.getByRole('navigation', { name: NAV.label });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual(EXPECTED_LINKS.map(([n, h]) => [n, h]));
    expect(within(nav).getByRole('link', { name: NAV.sources })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: NAV.newAsk })).not.toHaveAttribute('aria-current');
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

  it('shows the Nano meter card from the stores', async () => {
    useAvailability.setState({ text: 'available' });
    useIndexing.setState({ state: 'running', left: 36, done: 64, total: 100 });
    renderLayout('/');
    const meter = screen.getByRole('button', { name: /^Status: / });
    expect(meter).toHaveTextContent(`${RAIL.nano}${RAIL.nanoReady}`);
    expect(meter).toHaveTextContent(`${RAIL.index}${RAIL.indexing(64)}`);
    await expectNoAxeViolations();
  });

  it('hides the nav on /setup', async () => {
    renderLayout('/setup');
    expect(screen.queryByRole('navigation', { name: NAV.label })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: NAV.newAsk })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('has a menu button for phones that opens and closes the rail body', async () => {
    const user = userEvent.setup();
    renderLayout('/requests');
    const menu = screen.getByRole('button', { name: NAV.menu });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    expect(screen.getByRole('button', { name: NAV.closeMenu })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: NAV.closeMenu }));
    expect(screen.getByRole('button', { name: NAV.menu })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the phone menu when a link changes the route', async () => {
    const user = userEvent.setup();
    renderLayout('/requests');
    await user.click(screen.getByRole('button', { name: NAV.menu }));
    expect(screen.getByRole('button', { name: NAV.closeMenu })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('link', { name: NAV.sources }));
    expect(screen.getByRole('link', { name: NAV.sources })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: NAV.menu })).toHaveAttribute('aria-expanded', 'false');
  });
});
