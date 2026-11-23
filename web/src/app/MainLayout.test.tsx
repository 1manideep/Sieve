import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { NAV } from '@/copy/strings';
import { useHomeBase } from '@/state/homeBase';
import { sharedItemCount, useReceipts } from '@/state/receipts';
import { useSession } from '@/state/session';
import type { ReceiptView } from '@/state/types';
import { MainLayout } from './MainLayout';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));

const listened = vi.hoisted(() => ({ uids: [] as string[], stops: 0, items: 200 }));
vi.mock('@/app/services/receipts', () => ({
  listenReceipts: (uid: string) => {
    listened.uids.push(uid);
    return () => {
      listened.stops += 1;
    };
  },
  revokeReceipt: async () => undefined,
}));
// Gmail access running out has its own tests (components/GmailAccess); here only where it is mounted.
vi.mock('@/components/GmailAccess/GmailAccess', () => ({ GmailAccess: () => <p>Gmail access slot</p> }));
vi.mock('@/components/dbTables', () => ({
  loadIndex: async () => ({ openDb: () => ({ records: { count: async () => listened.items } }) }),
  tablesOf: (db: unknown) => db,
}));

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
] as const;

const receipt = (id: string, status: ReceiptView['status'], itemIds: string[]): ReceiptView => ({
  id,
  requestId: id,
  requester: { kind: 'outside', aiName: 'Claude', grantId: 'g1' } as ReceiptView['requester'],
  question: 'q',
  step: 'answer',
  itemIds,
  status,
  chars: 10,
  createdAt: 1,
});

afterEach(() => {
  vi.restoreAllMocks();
  useHomeBase.getState().reset();
  useReceipts.getState().reset();
  listened.uids = [];
  listened.stops = 0;
  listened.items = 200;
});

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
  it('renders the rail icons in order, each named, with the current one marked', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'mani@example.com', isAnonymous: false } });
    renderLayout('/sources');
    expect(screen.getByRole('link', { name: 'Sieve' })).toHaveAttribute('href', '/ask');
    const nav = screen.getByRole('navigation', { name: NAV.label });
    const lists = within(nav).getAllByRole('list');
    const links = within(lists[0]!).getAllByRole('link');
    expect(links.map((l) => [l.getAttribute('aria-label'), l.getAttribute('href')])).toEqual(EXPECTED_LINKS.map(([n, h]) => [n, h]));
    expect(within(nav).getByRole('link', { name: NAV.sources })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: NAV.newAsk })).not.toHaveAttribute('aria-current');
    expect(within(lists[1]!).getByRole('link', { name: NAV.settings })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    await screen.findByRole('link', { name: NAV.neverShared(100) });
    await expectNoAxeViolations();
  });

  it('mounts the Gmail access notice at the top of every page of a Google session', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', isAnonymous: false } });
    const { unmount } = renderLayout('/settings');
    const slot = await screen.findByText('Gmail access slot');
    expect(screen.getByRole('main').firstElementChild).toBe(slot);
    unmount();
    useSession.setState({ kind: 'google', user: { uid: 'u1', isAnonymous: false }, ownerConflict: true });
    renderLayout('/settings');
    await screen.findByRole('heading', { name: 'Screen' });
    expect(screen.queryByText('Gmail access slot')).not.toBeInTheDocument();
    act(() => useSession.setState({ ownerConflict: false }));
  });

  it('names the Requests icon with the waiting count', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', isAnonymous: false } });
    useHomeBase.setState({ awaitingCount: 2 });
    renderLayout('/ask');
    expect(screen.getByRole('link', { name: NAV.requestsWaiting(2) })).toHaveAttribute('href', '/requests');
    await screen.findByRole('link', { name: NAV.neverShared(100) });
  });

  it('listens to the receipts of the signed-in person and stops when the layout goes away', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u7', isAnonymous: false } });
    const view = renderLayout('/ask');
    await vi.waitFor(() => expect(listened.uids).toEqual(['u7']));
    const before = listened.stops;
    view.unmount();
    expect(listened.stops).toBe(before + 1);
  });

  it('shows the share of items never shared, from the index count and the loaded receipts', async () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', isAnonymous: false } });
    renderLayout('/ask');
    await screen.findByRole('link', { name: NAV.neverShared(100) });
    act(() =>
      useReceipts.setState({
        status: 'ready',
        receipts: [receipt('r1', 'delivered', ['gmail:1', 'gmail:2']), receipt('r2', 'declined', ['gmail:3']), receipt('r3', 'revoked', ['gmail:2', 'gmail:4'])],
      }),
    );
    const ring = screen.getByRole('link', { name: NAV.neverShared(98) });
    expect(ring).toHaveAttribute('href', '/sources');
    expect(ring).toHaveTextContent('98%');
    expect(ring).toHaveTextContent(NAV.neverSharedTip('197', '200'));
  });

  it('shows no ring while nothing is indexed', async () => {
    listened.items = 0;
    useSession.setState({ kind: 'google', user: { uid: 'u1', isAnonymous: false } });
    renderLayout('/ask');
    await vi.waitFor(() => expect(listened.uids.length).toBe(1));
    expect(screen.queryByRole('link', { name: /never shared/ })).not.toBeInTheDocument();
  });

  it('hides the icons on /setup', () => {
    useSession.setState({ kind: 'google', user: { uid: 'u1', isAnonymous: false } });
    renderLayout('/setup');
    expect(screen.getByRole('link', { name: 'Sieve' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: NAV.label })).not.toBeInTheDocument();
  });
});

describe('sharedItemCount', () => {
  it('counts each item once, and only for shares that left', () => {
    expect(sharedItemCount([receipt('a', 'delivered', ['x', 'y']), receipt('b', 'pending-collection', ['y', 'z']), receipt('c', 'blocked', ['q']), receipt('d', 'expired', ['w'])])).toBe(3);
  });
});
