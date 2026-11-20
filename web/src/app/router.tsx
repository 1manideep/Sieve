// The data router (40 section 5.2). Every screen uses route.lazy.
import { createBrowserRouter } from 'react-router-dom';
import { ROUTER_FUTURE, routes } from './routes';

export const router = createBrowserRouter(routes, { future: ROUTER_FUTURE });
