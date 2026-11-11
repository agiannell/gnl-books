import { ApolloProvider } from '@apollo/client/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import Home from '../src/Home.tsx';
import { fakeApi } from './fakeApi.ts';

const renderHome = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(handlers);
  const client = createApolloClient({ getAccessToken: async () => 'tok', fetch: api.fetch });
  render(
    <MemoryRouter>
      <ApolloProvider client={client}>
        <Home />
      </ApolloProvider>
    </MemoryRouter>,
  );
  return api;
};

const family = (profiles: { id: string; name: string; emoji: string | null; color: string | null }[]) => ({
  data: {
    family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: profiles.map((p) => ({ __typename: 'Profile', ...p })) },
  },
});

describe('Home', () => {
  it('asks who is reading, with a link to each profile’s page', async () => {
    renderHome({
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: family([
        { id: 'p-1', name: 'Pat', emoji: null, color: null },
        { id: 'p-2', name: 'Sam', emoji: '🦊', color: '#3366cc' },
      ]),
    });
    expect(await screen.findByRole('heading', { name: 'Who’s reading?' })).toBeTruthy();
    expect(screen.getByText('The Gnls')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Pat', '/p/p-1'],
      ['🦊Sam', '/p/p-2'],
      ['Parent settings', '/settings'],
    ]);
  });

  it('names each link by the reader alone, not by their emoji', async () => {
    renderHome({
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: family([{ id: 'p-2', name: 'Sam', emoji: '🦊', color: null }]),
    });
    expect(await screen.findByRole('link', { name: 'Sam' })).toBeTruthy();
  });

  it('colours a profile’s border with their colour, and leaves it alone without one', async () => {
    renderHome({
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: family([
        { id: 'p-1', name: 'Pat', emoji: null, color: null },
        { id: 'p-2', name: 'Sam', emoji: null, color: '#3366cc' },
      ]),
    });
    const sam = await screen.findByRole('link', { name: 'Sam' });
    // The card's ring reads this one variable; without one it uses the theme's own colour.
    expect(sam.style.getPropertyValue('--reader-color')).toMatch(/^(#3366cc|rgb\(51, 102, 204\))$/i);
    expect(screen.getByRole('link', { name: 'Pat' }).getAttribute('style')).toBeNull();
  });

  it('asks someone with no family to set one up, without asking the API for a family', async () => {
    const api = renderHome({
      Me: { data: { me: { __typename: 'Account', familyId: null } } },
      JoinRequestDenied: { data: { joinRequestDenied: false } },
    });
    expect(await screen.findByRole('heading', { name: 'Set up your family' })).toBeTruthy();
    // Someone with no family is also asked whether a parent declined them, never for a family.
    expect(api.calls.map((c) => c.operationName)).toEqual(['Me', 'JoinRequestDenied']);
  });

  it('shows an error when the API refuses', async () => {
    renderHome({ Me: { errors: [{ message: 'Not signed in' }] } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not signed in');
  });

  it('sends the bearer token with both queries', async () => {
    const api = renderHome({
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: family([]),
    });
    await screen.findByRole('heading', { name: 'Who’s reading?' });
    expect(api.calls).toEqual([
      { operationName: 'Me', authorization: 'Bearer tok' },
      { operationName: 'Family', authorization: 'Bearer tok' },
    ]);
  });
});
