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
  const router = createMemoryRouter(routes[0]!.children!, { initialEntries: [path] });
  render(
    <ApolloProvider client={client}>
      <RouterProvider router={router} />
    </ApolloProvider>,
  );
  return api;
};

const entryFields = (over: Record<string, unknown> = {}) => ({
  __typename: 'ShelfEntry',
  id: 'e-1',
  shelf: 'TO_READ',
  rating: null,
  review: null,
  dateRead: null,
  currentPage: null,
  ...over,
});

const bookPage = (entry: Record<string, unknown> = {}, bookOver: Record<string, unknown> = {}) => ({
  data: {
    profile: {
      __typename: 'Profile',
      id: 'p-2',
      name: 'Sam',
      shelf: [
        {
          ...entryFields(entry),
          book: {
            __typename: 'Book',
            id: 'b-1',
            title: 'Dog Man',
            authors: ['Dav Pilkey'],
            pages: 240,
            releaseYear: 2016,
            coverUrl: null,
            seriesName: 'Dog Man',
            seriesPosition: 1,
            description: 'A hero with a dog’s head.',
            ...bookOver,
          },
        },
      ],
    },
  },
});

const reply = (name: string, over: Record<string, unknown> = {}) => ({ data: { [name]: entryFields(over) } });
const failure = (message: string) => ({ errors: [{ message }] });
const PATH = '/p/p-2/book/b-1';
const lastCall = (api: ReturnType<typeof fakeApi>) => api.variables[api.variables.length - 1];
const names = (api: ReturnType<typeof fakeApi>) => api.calls.map((c) => c.operationName);

describe('BookPage', () => {
  it('shows the book and where it is on the reader’s shelf, asking for the profile in the address', async () => {
    const api = renderAt(PATH, { BookPage: bookPage() });
    expect(await screen.findByRole('heading', { name: 'Dog Man' })).toBeTruthy();
    expect(screen.getByText('by Dav Pilkey')).toBeTruthy();
    expect(screen.getByText('Dog Man #1')).toBeTruthy();
    expect(screen.getByText('2016 · 240 pages')).toBeTruthy();
    expect(screen.getByText('A hero with a dog’s head.')).toBeTruthy();
    expect(screen.getByText(/On Sam’s shelf:/).textContent).toBe('On Sam’s shelf: Want to read');
    expect(api.variables[0]).toEqual({ id: 'p-2' });
  });

  it('shows the book’s cover, or a plain tile when it has none', async () => {
    renderAt(PATH, { BookPage: bookPage({}, { coverUrl: 'https://assets.hardcover.app/books/1/cover.jpg' }) });
    await screen.findByRole('heading', { name: 'Dog Man' });
    expect(document.querySelector('.cover img')!.getAttribute('src')).toBe('https://assets.hardcover.app/books/1/cover.jpg');
    expect(document.querySelector('.cover-lg')).not.toBeNull();
  });

  it('shows a plain tile when the book has no cover', async () => {
    renderAt(PATH, { BookPage: bookPage() });
    await screen.findByRole('heading', { name: 'Dog Man' });
    expect(document.querySelector('.cover img')).toBeNull();
    expect(document.querySelector('.cover-placeholder')).not.toBeNull();
  });

  it('says so when the book is not on that reader’s shelves', async () => {
    renderAt('/p/p-2/book/other', { BookPage: bookPage() });
    expect(await screen.findByRole('heading', { name: 'Book not found' })).toBeTruthy();
    expect(screen.getByText('This book is not on Sam’s shelves.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the shelves' }).getAttribute('href')).toBe('/p/p-2');
  });

  it('shows the not-found page for a profile that is not in the family', async () => {
    renderAt(PATH, { BookPage: { data: { profile: null } } });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('shows the API’s message when the page cannot load', async () => {
    renderAt(PATH, { BookPage: failure('boom') });
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });

  describe('rating', () => {
    it('rates the book and shows the stars, then clears them', async () => {
      const api = renderAt(PATH, {
        BookPage: bookPage(),
        RateBook: [reply('rateBook', { rating: 4 }), reply('rateBook', { rating: null })],
      });
      const user = userEvent.setup();
      await screen.findByRole('heading', { name: 'Dog Man' });
      await user.click(screen.getByRole('button', { name: '4 stars' }));
      await waitFor(() => expect(screen.getByRole('button', { name: '4 stars' }).getAttribute('aria-pressed')).toBe('true'));
      expect(api.variables[1]).toEqual({ shelfEntryId: 'e-1', rating: 4 });
      expect(screen.getByRole('button', { name: '5 stars' }).getAttribute('aria-pressed')).toBe('false');
      expect(screen.getByText('4 out of 5 stars')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Clear rating' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear rating' })).toBeNull());
      expect(lastCall(api)).toEqual({ shelfEntryId: 'e-1', rating: null });
    });

    it('fills exactly as many stars as the rating', async () => {
      renderAt(PATH, { BookPage: bookPage({ rating: 3 }) });
      await screen.findByRole('heading', { name: 'Dog Man' });
      const glyphs = [1, 2, 3, 4, 5].map((n) => screen.getByRole('button', { name: `${n} ${n === 1 ? 'star' : 'stars'}` }).textContent);
      expect(glyphs).toEqual(['★', '★', '★', '☆', '☆']);
    });

    it('offers no way to clear a rating that is not set', async () => {
      renderAt(PATH, { BookPage: bookPage() });
      await screen.findByRole('heading', { name: 'Dog Man' });
      expect(screen.queryByRole('button', { name: 'Clear rating' })).toBeNull();
    });

    it('shows the API’s message when rating fails and keeps the old rating', async () => {
      renderAt(PATH, { BookPage: bookPage({ rating: 2 }), RateBook: failure('Shelf entry not found') });
      const user = userEvent.setup();
      await screen.findByRole('heading', { name: 'Dog Man' });
      await user.click(screen.getByRole('button', { name: '5 stars' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Shelf entry not found');
      expect(screen.getByRole('button', { name: '2 stars' }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('edits', () => {
    it('are one at a time: every edit control is off while one is running', async () => {
      let release: (value: unknown) => void = () => {};
      const held = new Promise((resolve) => (release = resolve));
      const api = renderAt(PATH, { BookPage: bookPage(), RateBook: () => held });
      const user = userEvent.setup();
      await screen.findByRole('heading', { name: 'Dog Man' });
      await user.click(screen.getByRole('button', { name: '4 stars' }));
      await waitFor(() => expect((screen.getByRole('button', { name: '5 stars' }) as HTMLButtonElement).disabled).toBe(true));
      // Pressing another star while the first is out must not send a second request.
      await user.click(screen.getByRole('button', { name: '5 stars' }));
      expect(names(api)).toEqual(['BookPage', 'RateBook']);
      release(reply('rateBook', { rating: 4 }));
      await waitFor(() => expect((screen.getByRole('button', { name: '5 stars' }) as HTMLButtonElement).disabled).toBe(false));
    });

    it('stop showing an earlier failure once the next one works', async () => {
      renderAt(PATH, {
        BookPage: bookPage(),
        RateBook: [failure('Shelf entry not found'), reply('rateBook', { rating: 5 })],
      });
      const user = userEvent.setup();
      await screen.findByRole('heading', { name: 'Dog Man' });
      await user.click(screen.getByRole('button', { name: '5 stars' }));
      await screen.findByRole('alert');
      await user.click(screen.getByRole('button', { name: '5 stars' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
  });

  it('asks the API again each time the page is opened, so changes made elsewhere show', async () => {
    const profile = (shelf: unknown[]) => ({
      data: { profile: { __typename: 'Profile', id: 'p-2', name: 'Sam', emoji: null, color: null, goal: null, shelf } },
    });
    const api = renderAt('/p/p-2', {
      ProfilePage: profile([
        {
          ...entryFields(),
          dateRead: null,
          book: { __typename: 'Book', id: 'b-1', title: 'Dog Man', authors: ['Dav Pilkey'], pages: 240, coverUrl: null, seriesName: null, seriesPosition: null },
        },
      ]),
      BookPage: [bookPage({ rating: null }), bookPage({ rating: 3 })],
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Dog Man' }));
    await screen.findByRole('heading', { name: 'Dog Man' });
    await user.click(screen.getByRole('link', { name: 'Back to the shelves' }));
    await user.click(await screen.findByRole('link', { name: 'Dog Man' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '3 stars' }).getAttribute('aria-pressed')).toBe('true'));
    expect(names(api).filter((n) => n === 'BookPage')).toHaveLength(2);
  });

  describe('review', () => {
    it('saves the trimmed review, and only offers to save when it changed', async () => {
      const api = renderAt(PATH, {
        BookPage: bookPage({ review: 'Fun' }),
        ReviewBook: reply('reviewBook', { review: 'Very fun' }),
      });
      const user = userEvent.setup();
      const box = (await screen.findByLabelText(/what did you think/i)) as HTMLTextAreaElement;
      const save = screen.getByRole('button', { name: 'Save review' }) as HTMLButtonElement;
      expect(box.value).toBe('Fun');
      expect(save.disabled).toBe(true);
      await user.type(box, ' ');
      expect(save.disabled).toBe(true);
      await user.clear(box);
      await user.type(box, '  Very fun ');
      expect(save.disabled).toBe(false);
      await user.click(save);
      await waitFor(() => expect((screen.getByRole('button', { name: 'Save review' }) as HTMLButtonElement).disabled).toBe(true));
      expect(lastCall(api)).toEqual({ shelfEntryId: 'e-1', review: 'Very fun' });
      expect((screen.getByLabelText(/what did you think/i) as HTMLTextAreaElement).value).toBe('Very fun');
    });

    it('clears a review by saving it empty', async () => {
      const api = renderAt(PATH, {
        BookPage: bookPage({ review: 'Fun' }),
        ReviewBook: reply('reviewBook', { review: null }),
      });
      const user = userEvent.setup();
      await user.clear(await screen.findByLabelText(/what did you think/i));
      await user.click(screen.getByRole('button', { name: 'Save review' }));
      await waitFor(() => expect(names(api)).toContain('ReviewBook'));
      expect(lastCall(api)).toEqual({ shelfEntryId: 'e-1', review: '' });
    });

    it('keeps what was typed when saving fails, and says why', async () => {
      renderAt(PATH, { BookPage: bookPage(), ReviewBook: failure('Review must be at most 5000 characters') });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText(/what did you think/i), 'Good');
      await user.click(screen.getByRole('button', { name: 'Save review' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Review must be at most 5000');
      expect((screen.getByLabelText(/what did you think/i) as HTMLTextAreaElement).value).toBe('Good');
    });
  });

  describe('progress', () => {
    it('logs the page, shows it against the book’s length, and clears the box', async () => {
      const api = renderAt(PATH, {
        BookPage: bookPage({ shelf: 'CURRENTLY_READING' }),
        LogProgress: reply('logProgress', { shelf: 'CURRENTLY_READING', currentPage: 120 }),
      });
      const user = userEvent.setup();
      const box = (await screen.findByLabelText(/i’m on page/i)) as HTMLInputElement;
      await user.type(box, ' 120 ');
      await user.click(screen.getByRole('button', { name: 'Save page' }));
      expect(await screen.findByText('Page 120 of 240')).toBeTruthy();
      expect(lastCall(api)).toEqual({ shelfEntryId: 'e-1', page: 120 });
      // The log records where the page came from; this is the web app, not Alexa.
      expect(api.queries[api.queries.length - 1]).toContain('source: WEB');
      expect(box.value).toBe('');
    });

    it('moves a want-to-read book to reading now when progress is logged', async () => {
      renderAt(PATH, {
        BookPage: bookPage(),
        LogProgress: reply('logProgress', { shelf: 'CURRENTLY_READING', currentPage: 10 }),
      });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText(/i’m on page/i), '10');
      await user.click(screen.getByRole('button', { name: 'Save page' }));
      await waitFor(() => expect(screen.getByText(/On Sam’s shelf:/).textContent).toBe('On Sam’s shelf: Reading now'));
    });

    it('shows just the page when the book’s length is not known', async () => {
      renderAt(PATH, { BookPage: bookPage({ shelf: 'CURRENTLY_READING', currentPage: 30 }, { pages: null }) });
      expect(await screen.findByText('Page 30')).toBeTruthy();
    });

    it.each(['', 'abc', '12.5', '-3'])('does not send %j as a page', async (text) => {
      const api = renderAt(PATH, { BookPage: bookPage({ shelf: 'CURRENTLY_READING' }) });
      const user = userEvent.setup();
      if (text) await user.type(await screen.findByLabelText(/i’m on page/i), text);
      await user.click(await screen.findByRole('button', { name: 'Save page' }));
      expect((await screen.findByRole('alert')).textContent).toBe('The page must be a whole number');
      expect(names(api)).toEqual(['BookPage']);
    });

    it('shows the API’s reason when the page is refused and keeps what was typed', async () => {
      renderAt(PATH, {
        BookPage: bookPage({ shelf: 'CURRENTLY_READING' }),
        LogProgress: failure('This book has 240 pages'),
      });
      const user = userEvent.setup();
      const box = (await screen.findByLabelText(/i’m on page/i)) as HTMLInputElement;
      await user.type(box, '999');
      await user.click(screen.getByRole('button', { name: 'Save page' }));
      expect((await screen.findByRole('alert')).textContent).toContain('This book has 240 pages');
      expect(box.value).toBe('999');
    });
  });

  describe('finishing', () => {
    it('finishes the book for today when no date is given, and swaps the finishing controls for the date', async () => {
      const api = renderAt(PATH, {
        BookPage: bookPage({ shelf: 'CURRENTLY_READING' }),
        FinishBook: reply('finishBook', { shelf: 'READ', dateRead: '2026-11-10' }),
      });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'I finished it' }));
      expect(await screen.findByText(/Finished Nov 10, 2026/)).toBeTruthy();
      expect(lastCall(api)).toEqual({ shelfEntryId: 'e-1', dateRead: null });
      expect(screen.queryByRole('button', { name: 'I finished it' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save page' })).toBeNull();
      expect(screen.getByText(/On Sam’s shelf:/).textContent).toContain('Read');
    });

    it('sends the date the reader picked', async () => {
      const api = renderAt(PATH, {
        BookPage: bookPage(),
        FinishBook: reply('finishBook', { shelf: 'READ', dateRead: '2026-02-14' }),
      });
      const user = userEvent.setup();
      const date = (await screen.findByLabelText(/date finished/i)) as HTMLInputElement;
      await user.type(date, '2026-02-14');
      await user.click(screen.getByRole('button', { name: 'I finished it' }));
      expect(await screen.findByText(/Finished Feb 14, 2026/)).toBeTruthy();
      expect(lastCall(api)).toEqual({ shelfEntryId: 'e-1', dateRead: '2026-02-14' });
    });

    it('shows the API’s message for a date in the future and leaves the book where it was', async () => {
      renderAt(PATH, {
        BookPage: bookPage(),
        FinishBook: failure('A book cannot be finished on a day that has not happened yet'),
      });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText(/date finished/i), '2999-01-01');
      await user.click(screen.getByRole('button', { name: 'I finished it' }));
      expect((await screen.findByRole('alert')).textContent).toContain('has not happened yet');
      expect(screen.getByText(/On Sam’s shelf:/).textContent).toBe('On Sam’s shelf: Want to read');
    });

    it('shows a finished book’s date and no finishing or progress controls', async () => {
      renderAt(PATH, { BookPage: bookPage({ shelf: 'READ', dateRead: '2026-02-14', rating: 5 }) });
      expect(await screen.findByText(/Finished Feb 14, 2026/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'I finished it' })).toBeNull();
      expect(screen.queryByLabelText(/i’m on page/i)).toBeNull();
    });
  });

  describe('moving between shelves', () => {
    it('offers only the other two shelves', async () => {
      renderAt(PATH, { BookPage: bookPage({ shelf: 'CURRENTLY_READING' }) });
      await screen.findByRole('heading', { name: 'Dog Man' });
      const move = screen.getByRole('region', { name: 'Move to' });
      expect([...move.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Want to read', 'Read']);
    });

    it('moves the book for the reader in the address and shows the new shelf', async () => {
      const api = renderAt(PATH, {
        BookPage: bookPage(),
        AddToShelf: { data: { addToShelf: { __typename: 'ShelfEntry', id: 'e-1', shelf: 'CURRENTLY_READING', dateRead: null, currentPage: null } } },
      });
      const user = userEvent.setup();
      await screen.findByRole('heading', { name: 'Dog Man' });
      await user.click(screen.getByRole('button', { name: 'Reading now' }));
      await waitFor(() => expect(screen.getByText(/On Sam’s shelf:/).textContent).toBe('On Sam’s shelf: Reading now'));
      expect(lastCall(api)).toEqual({ profileId: 'p-2', bookId: 'b-1', shelf: 'CURRENTLY_READING' });
    });

    it('moves a read book back, and the date it was finished stays out of the way', async () => {
      renderAt(PATH, {
        BookPage: bookPage({ shelf: 'READ', dateRead: '2026-02-14' }),
        AddToShelf: { data: { addToShelf: { __typename: 'ShelfEntry', id: 'e-1', shelf: 'TO_READ', dateRead: '2026-02-14', currentPage: null } } },
      });
      const user = userEvent.setup();
      await screen.findByText(/Finished Feb 14, 2026/);
      await user.click(screen.getByRole('button', { name: 'Want to read' }));
      await waitFor(() => expect(screen.getByText(/On Sam’s shelf:/).textContent).toBe('On Sam’s shelf: Want to read'));
    });
  });

  it('goes from the shelves to the book and back with the change showing', async () => {
    const shelfEntry = (over: Record<string, unknown>) => ({
      __typename: 'ShelfEntry',
      id: 'e-1',
      shelf: 'TO_READ',
      rating: null,
      dateRead: null,
      currentPage: null,
      book: { __typename: 'Book', id: 'b-1', title: 'Dog Man', authors: ['Dav Pilkey'], pages: 240, coverUrl: null, seriesName: null, seriesPosition: null },
      ...over,
    });
    const profile = (shelf: unknown[]) => ({
      data: { profile: { __typename: 'Profile', id: 'p-2', name: 'Sam', emoji: null, color: null, goal: null, shelf } },
    });
    renderAt('/p/p-2', {
      ProfilePage: [profile([shelfEntry({})]), profile([shelfEntry({ shelf: 'READ', dateRead: '2026-11-10', rating: 5 })])],
      BookPage: bookPage(),
      FinishBook: reply('finishBook', { shelf: 'READ', dateRead: '2026-11-10' }),
    });
    const user = userEvent.setup();
    await screen.findByText('Want to read (1)');
    await user.click(screen.getByRole('link', { name: 'Dog Man' }));
    await user.click(await screen.findByRole('button', { name: 'I finished it' }));
    await screen.findByText(/Finished Nov 10, 2026/);
    await user.click(screen.getByRole('link', { name: 'Back to the shelves' }));
    expect(await screen.findByText('Read (1)')).toBeTruthy();
    expect(screen.getByText('Want to read (0)')).toBeTruthy();
  });
});
