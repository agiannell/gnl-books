import { ApolloProvider } from '@apollo/client/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import { routes } from '../src/routes.tsx';
import { fakeApi } from './fakeApi.ts';

const renderAt = (path: string, handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(handlers);
  const client = createApolloClient({ getAccessToken: async () => 'tok', fetch: api.fetch });
  // Only the pages, not App: App adds the sign-in gate, which is tested on its own.
  const router = createMemoryRouter(routes[0]!.children!, { initialEntries: [path] });
  render(
    <ApolloProvider client={client}>
      <RouterProvider router={router} />
    </ApolloProvider>,
  );
  return api;
};

const hit = (sourceId: string | null, over: Record<string, unknown> = {}) => ({
  __typename: 'Book',
  sourceId,
  title: `Title ${sourceId}`,
  authors: ['Ann Lee'],
  pages: 200,
  releaseYear: 2019,
  seriesName: null,
  seriesPosition: null,
  ...over,
});

const results = (...books: unknown[]) => ({ data: { searchBooks: books } });
const imported = { data: { importBook: { __typename: 'Book', id: 'book-1' } } };
const added = { data: { addToShelf: { __typename: 'ShelfEntry', id: 'e-1', shelf: 'TO_READ' } } };

const search = async (text: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/title, author or isbn/i), text);
  await user.click(screen.getByRole('button', { name: 'Search' }));
  return user;
};

describe('SearchPage', () => {
  it('searches for the trimmed words and lists each book with its details', async () => {
    const api = renderAt('/p/p-2/search', {
      SearchBooks: results(hit('s-1', { title: 'Dog Man', seriesName: 'Dog Man', seriesPosition: 1 })),
    });
    await search('  dog man  ');
    expect(await screen.findByText('Dog Man', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('by Ann Lee')).toBeTruthy();
    expect(screen.getByText('Dog Man #1')).toBeTruthy();
    expect(screen.getByText('2019 · 200 pages')).toBeTruthy();
    expect(api.variables[0]).toEqual({ query: 'dog man' });
  });

  it('says nothing about results before a search, and says so when there are none', async () => {
    renderAt('/p/p-2/search', { SearchBooks: results() });
    expect(screen.queryByText(/no books found/i)).toBeNull();
    await search('zzzz');
    expect(await screen.findByText('No books found for “zzzz”.')).toBeTruthy();
  });

  it('asks the catalog again when the same words are searched twice', async () => {
    const api = renderAt('/p/p-2/search', { SearchBooks: results(hit('s-1')) });
    const user = await search('title');
    await screen.findByText('Title s-1');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.calls.filter((c) => c.operationName === 'SearchBooks')).toHaveLength(2));
  });

  it('names the words that were searched, not what has been typed since', async () => {
    renderAt('/p/p-2/search', { SearchBooks: results() });
    const user = await search('  zzzz  ');
    await screen.findByText('No books found for “zzzz”.');
    await user.type(screen.getByLabelText(/title, author or isbn/i), ' and more');
    expect(screen.getByText('No books found for “zzzz”.')).toBeTruthy();
  });

  it('clears an earlier error once a search works', async () => {
    renderAt('/p/p-2/search', {
      SearchBooks: [{ errors: [{ message: 'Book search is unavailable right now' }] }, results(hit('s-1'))],
    });
    const user = await search('title');
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Title s-1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not search for blank words', async () => {
    const api = renderAt('/p/p-2/search', { SearchBooks: results() });
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText(/title, author or isbn/i), '   ');
    expect(button.disabled).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('shows the API’s message when the search fails, and nothing from an earlier search', async () => {
    renderAt('/p/p-2/search', {
      SearchBooks: [
        results(hit('s-1')),
        { errors: [{ message: 'Book search is busy. Try again in a moment', extensions: { code: 'BOOK_SOURCE_RATE_LIMITED' } }] },
      ],
    });
    const user = await search('first');
    await screen.findByText('Title s-1');
    await user.clear(screen.getByLabelText(/title, author or isbn/i));
    await user.type(screen.getByLabelText(/title, author or isbn/i), 'second');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Book search is busy');
  });

  it('imports the book, then shelves it for the reader in the address', async () => {
    const api = renderAt('/p/p-2/search', {
      SearchBooks: results(hit('s-1')),
      ImportBook: imported,
      AddToShelf: added,
    });
    const user = await search('title');
    await screen.findByText('Title s-1');
    await user.click(screen.getByRole('button', { name: 'Reading now' }));
    expect((await screen.findByRole('status')).textContent).toBe('Added to Reading now');
    expect(api.calls.map((c) => c.operationName)).toEqual(['SearchBooks', 'ImportBook', 'AddToShelf']);
    expect(api.variables[1]).toEqual({ sourceId: 's-1' });
    expect(api.variables[2]).toEqual({ profileId: 'p-2', bookId: 'book-1', shelf: 'CURRENTLY_READING' });
  });

  it('offers all three shelves', async () => {
    renderAt('/p/p-2/search', { SearchBooks: results(hit('s-1')), ImportBook: imported, AddToShelf: added });
    const user = await search('title');
    await screen.findByText('Title s-1');
    await user.click(screen.getByRole('button', { name: 'Already read' }));
    await screen.findByText('Added to Read');
    await user.click(screen.getByRole('button', { name: 'Want to read' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Added to Want to read'));
  });

  it('reports a failed add on that book and lets the reader try again', async () => {
    const api = renderAt('/p/p-2/search', {
      SearchBooks: results(hit('s-1'), hit('s-2')),
      ImportBook: imported,
      AddToShelf: [{ errors: [{ message: 'Profile or book not found' }] }, added],
    });
    const user = await search('title');
    await screen.findByText('Title s-1');
    await user.click(screen.getAllByRole('button', { name: 'Want to read' })[0]!);
    expect((await screen.findByRole('alert')).textContent).toContain('Profile or book not found');
    // The other book is untouched, and the failed one can be tried again.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await user.click(screen.getAllByRole('button', { name: 'Want to read' })[0]!);
    expect((await screen.findByRole('status')).textContent).toBe('Added to Want to read');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls.filter((c) => c.operationName === 'AddToShelf')).toHaveLength(2);
  });

  it('cannot shelve a hit that has no catalog id', async () => {
    renderAt('/p/p-2/search', { SearchBooks: results(hit(null)) });
    await search('title');
    await screen.findByText('Title null');
    for (const button of screen.getAllByRole('button', { name: /read/i })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('shows the new book on the shelves when the reader goes back', async () => {
    const emptyProfile = { data: { profile: { __typename: 'Profile', id: 'p-2', name: 'Sam', emoji: null, color: null, goal: null, shelf: [] } } };
    const withBook = {
      data: {
        profile: {
          ...emptyProfile.data.profile,
          shelf: [
            {
              __typename: 'ShelfEntry',
              id: 'e-1',
              shelf: 'TO_READ',
              rating: null,
              dateRead: null,
              currentPage: null,
              book: { __typename: 'Book', id: 'book-1', title: 'Title s-1', authors: ['Ann Lee'], pages: 200, seriesName: null, seriesPosition: null },
            },
          ],
        },
      },
    };
    renderAt('/p/p-2', {
      ProfilePage: [emptyProfile, withBook],
      SearchBooks: results(hit('s-1')),
      ImportBook: imported,
      AddToShelf: added,
    });
    const user = userEvent.setup();
    await screen.findByText('Want to read (0)');
    await user.click(screen.getByRole('link', { name: 'Find a book' }));
    await user.type(await screen.findByLabelText(/title, author or isbn/i), 'title');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Want to read' }));
    await screen.findByRole('status');
    await user.click(screen.getByRole('link', { name: 'Back to the shelves' }));
    expect(await screen.findByText('Want to read (1)')).toBeTruthy();
  });
});
