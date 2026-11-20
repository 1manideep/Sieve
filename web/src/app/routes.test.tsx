import { screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { googleUser, setFakeAuthUser } from '@/test/fakes/firebaseAuth';
import { renderRoute } from '@/test/renderRoute';
import { NAV, ROUTE_ERROR, SCREENS, TITLES } from '@/copy/strings';
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
    expect(screen.getByRole('link', { name: ROUTE_ERROR.openPlayground })).toHaveAttribute('href', '/playground');
    await waitFor(() => expect(document.title).toBe(TITLES.notFound));
    await expectNoAxeViolations();
  });

  it('shows the welcome screen', async () => {
    renderRoute('/welcome');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.welcome.heading })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(TITLES.welcome));
    await expectNoAxeViolations();
  });

  it('opens the Playground without signing in', async () => {
    renderRoute('/playground');
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.playground.heading })).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { level: 1, name: SCREENS.ask.heading })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('offers Ask on the not-found screen', async () => {
    renderRoute('/missing');
    expect(await screen.findByRole('link', { name: ROUTE_ERROR.goToAsk })).toHaveAttribute('href', '/');
  });
});
