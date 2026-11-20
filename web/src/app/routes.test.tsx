import { screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { googleUser, setFakeAuthUser } from '@/test/fakes/firebaseAuth';
import { renderRoute } from '@/test/renderRoute';
import { NAV, PUBLIC_NAV, ROUTE_ERROR, SCREENS, TITLES } from '@/copy/strings';
import { useSession, whenAuthReady } from '@/state/session';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));
// This file tests the route map, not the seed: opening /playground must not leave 46 records seeding and the
// ingest queue running into the tests after it.
vi.mock('@/index', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/index')>()), seedPlayground: async () => undefined }));

// Every route is lazy. Load the modules once up front so a slow first transform on a busy machine never counts
// against a findBy window; the routes still resolve through lazy(), from the module cache.
beforeAll(async () => {
  await Promise.all([
    import('@/index'),
    import('../screens/not-found'),
    import('../screens/welcome'),
    import('../screens/how'),
    import('../screens/playground'),
    import('../screens/requests'),
    import('../screens/ask'),
  ]);
}, 60_000);

describe('routes, signed out', () => {
  beforeAll(async () => {
    setFakeAuthUser(null);
    await whenAuthReady();
  });

  it('shows the not-found screen for an unknown path, with no axe violations', async () => {
    renderRoute('/no-such-page');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.notFound.heading })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: ROUTE_ERROR.openSieve })).toHaveAttribute('href', '/playground');
    expect(screen.getByRole('contentinfo')).toHaveTextContent(PUBLIC_NAV.footer);
    await waitFor(() => expect(document.title).toBe(TITLES.notFound));
    await expectNoAxeViolations();
  });

  it('shows the welcome screen under the public header', async () => {
    renderRoute('/welcome');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.welcome.heading })).toBeInTheDocument();
    const site = screen.getByRole('navigation', { name: PUBLIC_NAV.label });
    expect(within(site).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      [PUBLIC_NAV.how, '/how'],
      [PUBLIC_NAV.playground, '/playground'],
      [PUBLIC_NAV.tryComputer, '/try'],
      [PUBLIC_NAV.github, 'https://example.com/sieve'],
    ]);
    expect(within(site).getByRole('link', { name: PUBLIC_NAV.github })).toHaveAttribute('target', '_blank');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: PUBLIC_NAV.openSieve })).toHaveAttribute('href', '/playground');
    expect(within(banner).getByText(PUBLIC_NAV.openSource)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(TITLES.welcome));
    await expectNoAxeViolations();
  });

  it('sends the old /landing to /welcome', async () => {
    const { router } = renderRoute('/landing');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.welcome.heading })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/welcome');
  });

  it('shows How it works without signing in, with the header link marked', async () => {
    renderRoute('/how');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.how.heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: PUBLIC_NAV.how })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(TITLES.how));
    await expectNoAxeViolations();
  });

  it('opens the Playground without signing in', async () => {
    const { router } = renderRoute('/playground');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/playground');
    await waitFor(() => expect(document.title).toBe(TITLES.playground));
    await expectNoAxeViolations();
  });

  it('sends a Google-only route to Welcome with the path in next', async () => {
    const { router } = renderRoute('/settings?x=1');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.welcome.heading })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/welcome');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/settings?x=1');
  });
});

describe('routes, Google user', () => {
  beforeAll(async () => {
    await whenAuthReady();
    useSession.setState({
      kind: 'google',
      status: 'ready',
      user: { uid: googleUser.uid, email: googleUser.email ?? undefined, displayName: 'Mani', isAnonymous: false },
    });
  });

  it('renders the main layout with the nav and the requested screen', async () => {
    renderRoute('/requests');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.requests.heading })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: NAV.label })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: NAV.requests })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toBe(TITLES.requests));
    await expectNoAxeViolations();
  });

  it('sends a Google user from Welcome to Ask', async () => {
    const { router } = renderRoute('/welcome');
    await waitFor(() => expect(document.title).toBe(TITLES.ask));
    expect(router.state.location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('offers Ask on the not-found screen', async () => {
    renderRoute('/missing');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.notFound.heading })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: ROUTE_ERROR.openSieve })).toHaveAttribute('href', '/');
  });
});
