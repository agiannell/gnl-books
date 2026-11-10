import { gql } from '@apollo/client';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import { fakeApi } from './fakeApi.ts';

const ME = gql`
  query Me {
    me {
      familyId
    }
  }
`;

describe('the API client', () => {
  it('sends the access token as a bearer token', async () => {
    const api = fakeApi({ Me: { data: { me: { familyId: null } } } });
    const client = createApolloClient({ getAccessToken: async () => 'tok-123', fetch: api.fetch });
    await client.query({ query: ME });
    expect(api.calls).toEqual([{ operationName: 'Me', authorization: 'Bearer tok-123' }]);
  });

  it('asks for a fresh token on every request', async () => {
    const api = fakeApi({ Me: { data: { me: { familyId: null } } } });
    let n = 0;
    const client = createApolloClient({ getAccessToken: async () => `tok-${++n}`, fetch: api.fetch });
    await client.query({ query: ME, fetchPolicy: 'network-only' });
    await client.query({ query: ME, fetchPolicy: 'network-only' });
    expect(api.calls.map((c) => c.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  it('sends no authorization header when there is no session', async () => {
    const api = fakeApi({ Me: { data: { me: { familyId: null } } } });
    const client = createApolloClient({ getAccessToken: async () => undefined, fetch: api.fetch });
    await client.query({ query: ME });
    expect(api.calls).toEqual([{ operationName: 'Me', authorization: null }]);
  });

  it('posts to /graphql on its own origin', async () => {
    const api = fakeApi({ Me: { data: { me: { familyId: null } } } });
    const client = createApolloClient({ getAccessToken: async () => 'tok', fetch: api.fetch });
    await client.query({ query: ME });
    expect(api.urls).toEqual(['/graphql']);
  });
});
