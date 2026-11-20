import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { ROUTE_ERROR } from '@/copy/strings';
import { RouteError, classifyRouteError } from './RouteError';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));

function renderThrowing(error: unknown) {
  const router = createMemoryRouter(
    [{ path: '/', errorElement: <RouteError />, loader: () => { throw error; }, element: <p>never</p> }],
    { initialEntries: ['/'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('classifyRouteError', () => {
  it('tells chunk failures apart from other errors', () => {
    expect(classifyRouteError(new TypeError('Failed to fetch dynamically imported module: /assets/ask.js'))).toBe('chunk');
    expect(classifyRouteError(new TypeError('Importing a module script failed.'))).toBe('chunk');
    expect(classifyRouteError(new Error('boom'))).toBe('other');
  });
});

describe('RouteError', () => {
  it('offers Reload after a chunk failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderThrowing(new TypeError('Failed to fetch dynamically imported module'));
    expect(await screen.findByRole('heading', { name: ROUTE_ERROR.updatedTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ROUTE_ERROR.reload })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a missing page: a signed-out person gets Open Sieve, which signs in, and no Playground link', async () => {
    renderThrowing(new Response('', { status: 404 }));
    expect(await screen.findByRole('heading', { name: ROUTE_ERROR.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ROUTE_ERROR.openSieve })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Playground/ })).toBeNull();
    await expectNoAxeViolations();
  });

  it('says nothing was shared after any other error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderThrowing(new Error('boom'));
    expect(await screen.findByRole('heading', { name: ROUTE_ERROR.brokeTitle })).toBeInTheDocument();
    expect(screen.getByText(ROUTE_ERROR.brokeBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: ROUTE_ERROR.goToAsk })).toHaveAttribute('href', '/ask');
    await expectNoAxeViolations();
  });
});
