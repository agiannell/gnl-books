import type { RouteObject } from 'react-router';
import App from './App.tsx';
import Home from './Home.tsx';
import ManualAddPage from './ManualAddPage.tsx';
import NotFound from './NotFound.tsx';
import ProfilePage from './ProfilePage.tsx';
import SearchPage from './SearchPage.tsx';

// Only the route definitions: no router is created here, so a test can build the
// same tree with `createMemoryRouter(routes)`, and main.tsx makes the browser one.
// Every page, the not-found one included, sits inside App and so behind the sign-in gate.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'p/:profileId', element: <ProfilePage /> },
      { path: 'p/:profileId/search', element: <SearchPage /> },
      { path: 'p/:profileId/add', element: <ManualAddPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
