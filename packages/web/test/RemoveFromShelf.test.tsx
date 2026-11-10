import { ApolloProvider } from '@apollo/client/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import { createParentSession } from '../src/parentSession.ts';
import { ParentSessionProvider } from '../src/ParentSessionProvider.tsx';
import { routes } from '../src/routes.tsx';
import { fakeApi } from './fakeApi.ts';

const future = () => Date.now() + 600_000;
const renewed = () => ({
  data: { renewParentUnlock: { __typename: 'ParentUnlock', token: 'parent', expiresAt: new Date(future()).toISOString() } },
});

const renderAt = (path: string, handlers: Parameters<typeof fakeApi>[0], options: { unlocked?: boolean } = {}) => {
  const requests: { operation: string; parentToken: string | null }[] = [];
  const api = fakeApi({ RenewParentUnlock: renewed, ...handlers });
  const session = createParentSession();
  if (options.unlocked) session.set({ token: 'parent', expiresAt: future() });
  const client = createApolloClient({
    getAccessToken: async () => 'tok',
    getParentToken: session.getToken,
    fetch: ((url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName: string };
      requests.push({ operation: body.operationName, parentToken: new Headers(init?.headers).get('x-parent-token') });
      return api.fetch(url as string, init);
    }) as typeof fetch,
  });
  const router = createMemoryRouter(routes[0]!.children!, { initialEntries: [path] });
  render(
    <ApolloProvider client={client}>
      <ParentSessionProvider session={session}>
        <RouterProvider router={router} />
      </ParentSessionProvider>
    </ApolloProvider>,
  );
  return { api, session, requests, router };
};

const book = (over: Record<string, unknown> = {}) => ({
  __typename: 'Book',
  id: 'b-1',
  title: 'Dog Man',
  authors: ['Dav Pilkey'],
  pages: 240,
  releaseYear: 2016,
  coverUrl: null,
  seriesName: null,
  seriesPosition: null,
  description: null,
  ...over,
});
const entry = (id = 'e-1', over: Record<string, unknown> = {}) => ({
  __typename: 'ShelfEntry',
  id,
  shelf: 'TO_READ',
  rating: null,
  review: null,
  dateRead: null,
  currentPage: null,
  book: book(),
  ...over,
});
const profile = (shelf: unknown[]) => ({
  data: { profile: { __typename: 'Profile', id: 'p-2', name: 'Sam', emoji: null, color: null, goal: null, shelf } },
});
const removed = { data: { removeFromShelf: true } };
const failure = (message: string) => ({ errors: [{ message }] });
const unlockReply = { data: { unlockParent: { __typename: 'ParentUnlock', token: 'parent', expiresAt: new Date(future()).toISOString() } } };
const PATH = '/p/p-2/book/b-1';

const card = async () => within(await screen.findByRole('region', { name: 'Remove from shelf' }));
const operations = (r: ReturnType<typeof renderAt>) => r.api.calls.map((c) => c.operationName).filter((n) => n !== 'RenewParentUnlock');

describe('removing a book from a shelf', () => {
  describe('while the app is locked', () => {
    it('asks for the parent PIN in the card, and offers nothing to remove', async () => {
      renderAt(PATH, { BookPage: profile([entry()]) });
      const c = await card();
      expect(c.getByLabelText('Parent PIN')).toBeTruthy();
      expect(c.getByText(/needs a parent/)).toBeTruthy();
      expect(c.queryByRole('button', { name: 'Remove from shelf' })).toBeNull();
    });

    it('offers the removal once the right PIN is entered, without leaving the page', async () => {
      const r = renderAt(PATH, { BookPage: profile([entry()]), UnlockParent: unlockReply });
      const user = userEvent.setup();
      const c = await card();
      await user.type(c.getByLabelText('Parent PIN'), '1234');
      await user.click(c.getByRole('button', { name: 'Unlock' }));
      expect(await c.findByRole('button', { name: 'Remove from shelf' })).toBeTruthy();
      expect(c.queryByLabelText('Parent PIN')).toBeNull();
      expect(operations(r)).toEqual(['BookPage', 'UnlockParent']);
    });

    it('stays locked on a wrong PIN, and says how many tries are left', async () => {
      renderAt(PATH, {
        BookPage: profile([entry()]),
        UnlockParent: { errors: [{ message: 'Incorrect PIN', extensions: { code: 'PIN_INCORRECT', attemptsRemaining: 4 } }] },
      });
      const user = userEvent.setup();
      const c = await card();
      await user.type(c.getByLabelText('Parent PIN'), '0000');
      await user.click(c.getByRole('button', { name: 'Unlock' }));
      expect((await c.findByRole('alert')).textContent).toBe('Incorrect PIN. 4 tries left');
      expect(c.queryByRole('button', { name: 'Remove from shelf' })).toBeNull();
    });
  });

  describe('once unlocked', () => {
    it('asks before it removes anything, naming the book and the reader, and sends nothing yet', async () => {
      const r = renderAt(PATH, { BookPage: profile([entry()]) }, { unlocked: true });
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      expect(c.getByText(/Remove “Dog Man” from Sam’s shelf\?/)).toBeTruthy();
      expect(c.getByText(/rating, review and reading history go too/)).toBeTruthy();
      expect(c.getByText(/cannot be undone/)).toBeTruthy();
      expect(operations(r)).toEqual(['BookPage']);
    });

    it('leaves the book alone when the parent keeps it', async () => {
      const r = renderAt(PATH, { BookPage: profile([entry()]) }, { unlocked: true });
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      await user.click(c.getByRole('button', { name: 'Keep it' }));
      expect(c.queryByText(/cannot be undone/)).toBeNull();
      expect(c.getByRole('button', { name: 'Remove from shelf' })).toBeTruthy();
      expect(operations(r)).toEqual(['BookPage']);
    });

    it('removes that entry with the parent token, and goes back to the reader’s shelves without the book', async () => {
      const r = renderAt(
        PATH,
        { BookPage: profile([entry()]), ProfilePage: profile([]), RemoveFromShelf: removed },
        { unlocked: true },
      );
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      expect(await screen.findByRole('heading', { name: 'Sam' })).toBeTruthy();
      expect(r.router.state.location.pathname).toBe('/p/p-2');
      expect(screen.queryByRole('link', { name: 'Dog Man' })).toBeNull();
      const call = r.api.calls.findIndex((x) => x.operationName === 'RemoveFromShelf');
      expect(r.api.variables[call]).toEqual({ shelfEntryId: 'e-1' });
      expect(r.requests.find((x) => x.operation === 'RemoveFromShelf')!.parentToken).toBe('parent');
    });

    it('removes any book on the shelf, not only the first', async () => {
      const r = renderAt(
        '/p/p-2/book/b-2',
        {
          BookPage: profile([entry('e-1'), entry('e-2', { book: book({ id: 'b-2', title: 'Cat Kid' }) })]),
          ProfilePage: profile([entry('e-1')]),
          RemoveFromShelf: removed,
        },
        { unlocked: true },
      );
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      await screen.findByRole('heading', { name: 'Sam' });
      expect(r.api.variables[r.api.calls.findIndex((x) => x.operationName === 'RemoveFromShelf')]).toEqual({ shelfEntryId: 'e-2' });
      expect(await screen.findByRole('link', { name: 'Dog Man' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Cat Kid' })).toBeNull();
    });

    it('does not show the removed book on the shelves while they load again', async () => {
      // The shelves are cached with the book on them. If they were shown as they were, the book would
      // appear for a moment after it was removed.
      let release: (value: unknown) => void = () => {};
      const held = new Promise((resolve) => (release = resolve));
      renderAt(
        '/p/p-2',
        { ProfilePage: [profile([entry()]), () => held], BookPage: profile([entry()]), RemoveFromShelf: removed },
        { unlocked: true },
      );
      const user = userEvent.setup();
      await user.click(await screen.findByRole('link', { name: 'Dog Man' }));
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      // The shelves are asked for again and the reply is held back: the book must not be there meanwhile.
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Remove from shelf' })).toBeNull());
      expect(screen.queryByRole('link', { name: 'Dog Man' })).toBeNull();
      expect(screen.queryByText('Book not found')).toBeNull();
      release(profile([]));
      expect(await screen.findByText('Reading now (0)')).toBeTruthy();
    });

    it('does not flash "Book not found" on the way out', async () => {
      renderAt(
        PATH,
        { BookPage: profile([entry()]), ProfilePage: profile([]), RemoveFromShelf: removed },
        { unlocked: true },
      );
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      const seen: string[] = [];
      const watcher = new MutationObserver(() => {
        if (screen.queryByText('Book not found')) seen.push('Book not found');
      });
      watcher.observe(document.body, { childList: true, subtree: true });
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      await screen.findByRole('heading', { name: 'Sam' });
      watcher.disconnect();
      expect(seen).toEqual([]);
    });

    it('shows the API’s reason and stays on the book, with the question still open to try again', async () => {
      const r = renderAt(
        PATH,
        { BookPage: profile([entry()]), ProfilePage: profile([]), RemoveFromShelf: [failure('Shelf entry not found'), removed] },
        { unlocked: true },
      );
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      expect((await c.findByRole('alert')).textContent).toBe('Something went wrong: Shelf entry not found');
      expect(r.router.state.location.pathname).toBe(PATH);
      expect(c.getByRole('button', { name: 'Yes, remove it' })).toBeTruthy();
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      expect(await screen.findByRole('heading', { name: 'Sam' })).toBeTruthy();
    });

    it('waits for the answer: both buttons are off while the request is out', async () => {
      let release: (value: unknown) => void = () => {};
      const held = new Promise((resolve) => (release = resolve));
      const r = renderAt(
        PATH,
        { BookPage: profile([entry()]), ProfilePage: profile([]), RemoveFromShelf: () => held },
        { unlocked: true },
      );
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      await waitFor(() => expect((c.getByRole('button', { name: 'Yes, remove it' }) as HTMLButtonElement).disabled).toBe(true));
      expect((c.getByRole('button', { name: 'Keep it' }) as HTMLButtonElement).disabled).toBe(true);
      await user.click(c.getByRole('button', { name: 'Yes, remove it' }));
      expect(r.api.calls.filter((x) => x.operationName === 'RemoveFromShelf')).toHaveLength(1);
      release(removed);
      await screen.findByRole('heading', { name: 'Sam' });
    });

    it('forgets the question if the unlock runs out, so it is not waiting after the PIN is entered again', async () => {
      const r = renderAt(PATH, { BookPage: profile([entry()]) }, { unlocked: true });
      const user = userEvent.setup();
      const c = await card();
      await user.click(await c.findByRole('button', { name: 'Remove from shelf' }));
      expect(c.getByText(/cannot be undone/)).toBeTruthy();
      act(() => r.session.set(null));
      expect(await c.findByLabelText('Parent PIN')).toBeTruthy();
      expect(c.queryByText(/cannot be undone/)).toBeNull();
      act(() => r.session.set({ token: 'parent', expiresAt: future() }));
      expect(await c.findByRole('button', { name: 'Remove from shelf' })).toBeTruthy();
      expect(c.queryByText(/cannot be undone/)).toBeNull();
    });
  });

  it('is on the page for a book on any shelf', async () => {
    renderAt(PATH, { BookPage: profile([entry('e-1', { shelf: 'READ', dateRead: '2026-02-14' })]) });
    expect(await (await card()).findByLabelText('Parent PIN')).toBeTruthy();
  });
});
