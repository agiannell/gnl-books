import '@fontsource-variable/nunito';
import '@radix-ui/themes/styles.css';
import { ApolloProvider } from '@apollo/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createApolloClient } from './apollo.ts';
import { getAccessToken, userManager } from './auth.ts';
import './index.css';
import { ParentSessionProvider } from './ParentSessionProvider.tsx';
import { createParentSession } from './parentSession.ts';
import { routes } from './routes.tsx';

const router = createBrowserRouter(routes);
const parentSession = createParentSession();
const client = createApolloClient({ getAccessToken, getParentToken: parentSession.getToken });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider
      userManager={userManager}
      // Back from the Hosted UI: drop ?code=&state= from the address bar and
      // go to the page the person was heading to when they were sent to sign in.
      onSigninCallback={(user) => {
        const returnTo = (user?.state as { returnTo?: string } | undefined)?.returnTo ?? '/';
        void router.navigate(returnTo, { replace: true });
      }}
    >
      <ApolloProvider client={client}>
        <ParentSessionProvider session={parentSession}>
          <RouterProvider router={router} />
        </ParentSessionProvider>
      </ApolloProvider>
    </AuthProvider>
  </StrictMode>,
);
