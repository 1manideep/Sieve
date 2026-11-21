import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { NAV, RAIL } from '@/copy/strings';
import { useAvailability } from '@/state/availability';
import { useHomeBase } from '@/state/homeBase';
import { useIndexing } from '@/state/indexing';
import { useSession } from '@/state/session';
import { MainLayout, RAIL_KEY } from './MainLayout';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));

function renderLayout(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <h1>Landing</h1> },
      { element: <MainLayout />, children: [{ path: '*', element: <h1>Screen</h1> }] },
    ],
    { initialEntries: [path] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

const EXPECTED_LINKS = [
  [NAV.newAsk, '/ask'],
  [NAV.tryComputer, '/try'],
  [NAV.requests, '/requests'],
  [NAV.seen, '/seen'],
  [NAV.sources, '/sources'],
  [NAV.settings, '/settings'],
] as const;

describe('MainLayout: the session ends while a signed-in screen is open', () => {
  it('leaves for the landing when the Google session ends (sign-out here or in another tab)', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'mani@example.com', isAnonymous: false } });
    const { router } = renderLayout('/sources');
    expect(screen.getByRole('heading', { name: 'Screen' })).toBeInTheDocument();
    act(() => useSession.setState({ kind: 'none', user: null }));
    expect(await screen.findByRole('heading', { name: 'Landing' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('MainLayout', () => {
  afterEach(() => {
    localStorage.removeItem(RAIL_KEY);
    vi.restoreAllMocks();
    useHomeBase.getState().reset();
    useAvailability.setState({ text: 'checking', image: 'checking', setup: { state: 'idle' } });
    useIndexing.setState({ state: 'idle', left: 0, done: 0, total: 0, etaMs: undefined });
  });

  it('renders the rail links in order, with the active one marked', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'mani@example.com', isAnonymous: false } });
    renderLayout('/sources');
    expect(screen.getByRole('link', { name: 'Sieve' })).toHaveAttribute('href', '/ask');
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
    renderLayout('/ask');
    expect(screen.getByRole('link', { name: NAV.requestsWaiting(2) })).toHaveAttribute('href', '/requests');
    await expectNoAxeViolations();
  });

  it('shows the Nano meter card from the stores', async () => {
    useAvailability.setState({ text: 'available' });
    useIndexing.setState({ state: 'running', left: 36, done: 64, total: 100 });
    renderLayout('/ask');
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

  it('hides the rail and shows it again, moving focus and remembering the choice on this device', async () => {
    const user = userEvent.setup();
    const view = renderLayout('/requests');
    const shell = view.container.firstElementChild as HTMLElement;
    const rail = screen.getByRole('banner');
    expect(shell).toHaveAttribute('data-rail', 'shown');
    const hide = screen.getByRole('button', { name: NAV.hideMenu });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', rail.id);
    expect(screen.queryByRole('button', { name: NAV.showMenu })).toBeNull();

    await user.click(hide);
    expect(shell).toHaveAttribute('data-rail', 'hidden');
    const show = screen.getByRole('button', { name: NAV.showMenu });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', rail.id);
    expect(show).toHaveFocus();
    expect(localStorage.getItem(RAIL_KEY)).toBe('hidden');
    await expectNoAxeViolations();

    await user.keyboard('{Enter}');
    expect(shell).toHaveAttribute('data-rail', 'shown');
    expect(screen.queryByRole('button', { name: NAV.showMenu })).toBeNull();
    expect(screen.getByRole('button', { name: NAV.hideMenu })).toHaveFocus();
    expect(localStorage.getItem(RAIL_KEY)).toBe('shown');
  });

  it('starts hidden when this device hid it before, and shown by default', () => {
    localStorage.setItem(RAIL_KEY, 'hidden');
    const hidden = renderLayout('/ask');
    expect(hidden.container.firstElementChild).toHaveAttribute('data-rail', 'hidden');
    expect(screen.getByRole('button', { name: NAV.showMenu })).not.toHaveFocus();
    hidden.unmount();
    localStorage.removeItem(RAIL_KEY);
    const shown = renderLayout('/ask');
    expect(shown.container.firstElementChild).toHaveAttribute('data-rail', 'shown');
    expect(screen.getByRole('button', { name: NAV.hideMenu })).toBeInTheDocument();
  });

  it('still hides the rail when this browser keeps nothing', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const view = renderLayout('/ask');
    expect(view.container.firstElementChild).toHaveAttribute('data-rail', 'shown');
    await user.click(screen.getByRole('button', { name: NAV.hideMenu }));
    expect(view.container.firstElementChild).toHaveAttribute('data-rail', 'hidden');
    expect(screen.getByRole('button', { name: NAV.showMenu })).toHaveFocus();
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
