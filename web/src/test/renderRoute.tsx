// Mounts the real route map in a memory router.
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ROUTER_FUTURE, routes } from '@/app/routes';

export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: ROUTER_FUTURE });
  const view = render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
  return { router, ...view };
}
