import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';
import { HttpLink } from '@apollo/client/link/http';

export interface ClientOptions {
  /** The Cognito access token, or undefined when signed out. */
  getAccessToken: () => Promise<string | undefined>;
  /** Replaces the global fetch; for tests. */
  fetch?: typeof fetch;
}

/**
 * The API is on the same origin at /graphql (CloudFront in production, the Vite
 * proxy in development), so there is no CORS to configure.
 */
export function createApolloClient({ getAccessToken, fetch }: ClientOptions) {
  const authorization = new SetContextLink(async ({ headers }) => {
    const token = await getAccessToken();
    return token ? { headers: { ...headers, authorization: `Bearer ${token}` } } : {};
  });
  return new ApolloClient({
    link: ApolloLink.from([authorization, new HttpLink({ uri: '/graphql', ...(fetch && { fetch }) })]),
    cache: new InMemoryCache(),
  });
}
