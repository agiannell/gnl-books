import { ApolloProvider } from '@apollo/client/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import ProfilePage from '../src/ProfilePage.tsx';
import { fakeApi } from './fakeApi.ts';

const renderAt = (path: string, handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(handlers);
  const client = createApolloClient({ getAccessToken: async () => 'tok', fetch: api.fetch });
  render(
    <MemoryRouter initialEntries={[path]}>
      <ApolloProvider client={client}>
        <Routes>
          <Route path="/p/:profileId" element={<ProfilePage />} />
          <Route path="/" element={<p>start</p>} />
        </Routes>
      </ApolloProvider>
    </MemoryRouter>,
  );
  return api;
};

const profile = (over = {}) => ({
  data: { profile: { __typename: 'Profile', id: 'p-2', name: 'Sam', emoji: '🦊', color: '#3366cc', ...over } },
});

describe('ProfilePage', () => {
  it('names the reader, asking the API for the profile in the address', async () => {
    const api = renderAt('/p/p-2', { ProfilePage: profile() });
    expect(await screen.findByRole('heading', { name: /Sam/ })).toBeTruthy();
    expect(api.variables).toEqual([{ id: 'p-2' }]);
    expect(api.calls[0]?.authorization).toBe('Bearer tok');
  });

  it('works without an emoji', async () => {
    renderAt('/p/p-2', { ProfilePage: profile({ emoji: null }) });
    expect((await screen.findByRole('heading')).textContent).toBe('Sam');
  });

  it('links back to who’s reading', async () => {
    renderAt('/p/p-2', { ProfilePage: profile() });
    const link = await screen.findByRole('link', { name: 'Switch reader' });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('says the page is not found for a profile the family does not have', async () => {
    renderAt('/p/someone-elses', { ProfilePage: { data: { profile: null } } });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to who’s reading' }).getAttribute('href')).toBe('/');
  });

  it('shows an error when the API refuses', async () => {
    renderAt('/p/p-2', { ProfilePage: { errors: [{ message: 'Not signed in' }] } });
    expect((await screen.findByRole('alert')).textContent).toContain('Not signed in');
  });
});
