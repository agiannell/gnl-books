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

const entry = (id: string, shelf: string, over: Record<string, unknown> = {}) => ({
  __typename: 'ShelfEntry',
  id,
  shelf,
  rating: null,
  dateRead: null,
  currentPage: null,
  book: {
    __typename: 'Book',
    id: `book-${id}`,
    title: `Title ${id}`,
    authors: ['Ann Lee'],
    pages: 200,
    coverUrl: null,
    seriesName: null,
    seriesPosition: null,
  },
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({
  data: {
    profile: {
      __typename: 'Profile',
      id: 'p-2',
      name: 'Sam',
      emoji: '🦊',
      color: '#3366cc',
      goal: null,
      shelf: [],
      ...over,
    },
  },
});

describe('ProfilePage', () => {
  it('names the reader, asking the API for the profile in the address', async () => {
    const api = renderAt('/p/p-2', { ProfilePage: profile() });
    expect(await screen.findByRole('heading', { name: /Sam/, level: 1 })).toBeTruthy();
    expect(api.variables).toEqual([{ id: 'p-2' }]);
    expect(api.calls[0]?.authorization).toBe('Bearer tok');
  });

  it('works without an emoji', async () => {
    renderAt('/p/p-2', { ProfilePage: profile({ emoji: null }) });
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Sam');
  });

  it('shows the reader’s books on their shelves', async () => {
    renderAt('/p/p-2', {
      ProfilePage: profile({
        shelf: [
          entry('e1', 'CURRENTLY_READING', { currentPage: 50 }),
          entry('e2', 'TO_READ'),
          entry('e3', 'READ', { rating: 5, dateRead: '2026-02-14' }),
        ],
      }),
    });
    expect(await screen.findByRole('heading', { name: 'Reading now (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Want to read (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Read (1)' })).toBeTruthy();
    expect(screen.getByText('Page 50 of 200')).toBeTruthy();
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeTruthy();
    expect(screen.getByText('Finished Feb 14, 2026')).toBeTruthy();
  });

  it('shows this year’s goal when there is one, and nothing about goals when there is not', async () => {
    renderAt('/p/p-2', {
      ProfilePage: [profile({ goal: { __typename: 'ReadingGoal', year: 2026, target: 12, booksRead: 3 } })],
    });
    expect(await screen.findByText('2026 goal: 3 of 12 books')).toBeTruthy();
  });

  it('shows no goal bar without a goal', async () => {
    renderAt('/p/p-2', { ProfilePage: profile({ goal: null }) });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('progressbar')).toBeNull();
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
