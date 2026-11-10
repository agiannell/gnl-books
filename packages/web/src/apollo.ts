import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';
import { HttpLink } from '@apollo/client/link/http';

export interface ClientOptions {
  /** The Cognito access token, or undefined when signed out. */
  getAccessToken: () => Promise<string | undefined>;
  /** The parent unlock token, or undefined while the app is locked. */
  getParentToken?: () => string | undefined;
  /** Replaces the global fetch; for tests. */
  fetch?: typeof fetch;
}

/**
 * The API is on the same origin at /graphql (CloudFront in production, the Vite
 * proxy in development), so there is no CORS to configure.
 */
export function createApolloClient({ getAccessToken, getParentToken, fetch }: ClientOptions) {
  const authorization = new SetContextLink(async ({ headers }) => {
    const token = await getAccessToken();
    // Read per request, so an unlock (or a lock) takes effect on the very next call.
    const parentToken = getParentToken?.();
    return {
      headers: {
        ...headers,
        ...(token && { authorization: `Bearer ${token}` }),
        ...(parentToken && { 'x-parent-token': parentToken }),
      },
    };
  });
  return new ApolloClient({
    link: ApolloLink.from([authorization, new HttpLink({ uri: '/graphql', ...(fetch && { fetch }) })]),
    cache: new InMemoryCache(),
  });
}
