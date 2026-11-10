import { ApolloProvider } from '@apollo/client/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import Home from '../src/Home.tsx';
import { fakeApi } from './fakeApi.ts';

const renderHome = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(handlers);
  const client = createApolloClient({ getAccessToken: async () => 'tok', fetch: api.fetch });
  render(
    <ApolloProvider client={client}>
      <Home />
    </ApolloProvider>,
  );
  return api;
};

describe('Home', () => {
  it('lists the family’s profiles, marking parents', async () => {
    renderHome({
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: {
        data: {
          family: {
            __typename: 'Family',
            name: 'The Gnls',
            profiles: [
              { __typename: 'Profile', id: 'p-1', name: 'Pat', emoji: null, isParent: true },
              { __typename: 'Profile', id: 'p-2', name: 'Sam', emoji: '🦊', isParent: false },
            ],
          },
        },
      },
    });
    expect(await screen.findByRole('heading', { name: 'The Gnls' })).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(items).toEqual(['Pat (parent)', '🦊 Sam']);
  });

  it('says there is no family yet, without asking for one', async () => {
    const api = renderHome({ Me: { data: { me: { __typename: 'Account', familyId: null } } } });
    expect(await screen.findByText(/no family yet/)).toBeTruthy();
    expect(api.calls.map((c) => c.operationName)).toEqual(['Me']);
  });

  it('shows an error when the API refuses', async () => {
    renderHome({ Me: { errors: [{ message: 'Not signed in' }] } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not signed in');
  });

  it('sends the bearer token with both queries', async () => {
    const api = renderHome({
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: { data: { family: { __typename: 'Family', name: 'The Gnls', profiles: [] } } },
    });
    await screen.findByRole('heading', { name: 'The Gnls' });
    expect(api.calls).toEqual([
      { operationName: 'Me', authorization: 'Bearer tok' },
      { operationName: 'Family', authorization: 'Bearer tok' },
    ]);
  });
});
