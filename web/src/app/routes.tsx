// Route map (40 sections 5.1 and 5.2). Kept apart from router.tsx so tests can mount it in a memory router.
import { redirect, type LoaderFunctionArgs, type RouteObject } from 'react-router-dom';
import { AppShell } from './AppShell';
import { requireGoogle } from './guards';
import { MainLayout } from './MainLayout';
import { PublicLayout } from './PublicLayout';
import { RouteError } from './RouteError';

export const routes: RouteObject[] = [
  {
    element: <AppShell />,                 // providers, toasts, announcer, dialog host, session bootstrap
    errorElement: <RouteError />,
    children: [
      { element: <PublicLayout />, children: [
        { path: '/', lazy: () => import('../screens/welcome') },   // the landing, for everyone; the app lives at /ask
        { path: '/welcome', loader: ({ request }: LoaderFunctionArgs) => redirect('/' + new URL(request.url).search) },
        { path: '/how', lazy: () => import('../screens/how') },
        { path: '/prepare', lazy: () => import('../screens/prepare') },
        { path: '/try', lazy: () => import('../screens/try') },
        ...(import.meta.env.DEV
          ? [
              { path: '/dev/privacy', lazy: async () => ({ Component: (await import('../privacy/dev/PrivacyBench')).PrivacyBench }) },
              { path: '/dev/seed', lazy: async () => ({ Component: (await import('../playground/devSeed')).DevSeedPage }) },
            ]
          : []),
      ]},
      { path: '/playground', lazy: () => import('../screens/playground') },
      { path: '/landing', loader: () => redirect('/') },   // the old opening screen; the landing is the root now
      { element: <MainLayout />, loader: requireGoogle, children: [
        { path: '/ask', lazy: () => import('../screens/ask') },
        { path: '/requests', lazy: () => import('../screens/requests') },
        { path: '/sources', lazy: () => import('../screens/sources') },
        { path: '/seen', lazy: () => import('../screens/seen') },
        { path: '/settings', lazy: () => import('../screens/settings') },
        { path: '/setup', lazy: () => import('../screens/setup') },
      ]},
      { element: <PublicLayout />, children: [{ path: '*', lazy: () => import('../screens/not-found') }] },
    ],
  },
];

export const ROUTER_FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_skipActionErrorRevalidation: true,
} as const;
