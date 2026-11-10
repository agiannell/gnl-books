import type { RouteObject } from 'react-router';
import App from './App.tsx';
import Home from './Home.tsx';

// Only the route definitions: no router is created here, so a test can build the
// same tree with `createMemoryRouter(routes)`, and main.tsx makes the browser one.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [{ index: true, element: <Home /> }],
  },
];
