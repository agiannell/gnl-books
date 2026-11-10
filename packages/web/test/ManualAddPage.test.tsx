import { ApolloProvider } from '@apollo/client/react';
import { render, screen } from '@testing-library/react';
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

const made = { data: { addManualBook: { __typename: 'Book', id: 'book-9' } } };
const shelved = { data: { addToShelf: { __typename: 'ShelfEntry', id: 'e-1', shelf: 'TO_READ' } } };

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const fill = async (user: ReturnType<typeof userEvent.setup>, values: Record<string, string>) => {
  if (values.title) await user.type(field(/^title/i), values.title);
  if (values.authors) await user.type(field(/^authors/i), values.authors);
  if (values.pages) await user.type(field(/^pages/i), values.pages);
  if (values.year) await user.type(field(/^year/i), values.year);
};
const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Add book' }));

describe('ManualAddPage', () => {
  it('saves the book with its authors split and numbers parsed, then shelves it for the reader in the address', async () => {
    const api = renderAt('/p/p-2/add', { AddManualBook: made, AddToShelf: shelved });
    const user = userEvent.setup();
    await fill(user, { title: '  Our Family Cookbook ', authors: 'Ann Lee,  Bo Lee, ,', pages: '120', year: '2020' });
    await user.selectOptions(screen.getByLabelText('Shelf'), 'Reading now');
    await submit(user);
    expect((await screen.findByRole('status')).textContent).toBe('Added “Our Family Cookbook” to Reading now');
    expect(api.calls.map((c) => c.operationName)).toEqual(['AddManualBook', 'AddToShelf']);
    expect(api.variables[0]).toEqual({
      input: { title: 'Our Family Cookbook', authors: ['Ann Lee', 'Bo Lee'], pages: 120, releaseYear: 2020 },
    });
    expect(api.variables[1]).toEqual({ profileId: 'p-2', bookId: 'book-9', shelf: 'CURRENTLY_READING' });
  });

  it('sends null for pages and year left empty, and clears the form after an add', async () => {
    const api = renderAt('/p/p-2/add', { AddManualBook: made, AddToShelf: shelved });
    const user = userEvent.setup();
    await fill(user, { title: 'Zine', authors: 'Cam' });
    await submit(user);
    await screen.findByRole('status');
    expect(api.variables[0]).toEqual({ input: { title: 'Zine', authors: ['Cam'], pages: null, releaseYear: null } });
    expect([field(/^title/i).value, field(/^authors/i).value, field(/^pages/i).value, field(/^year/i).value]).toEqual(['', '', '', '']);
  });

  it.each([
    ['no title', { authors: 'Cam' }, 'Give the book a title'],
    ['no author', { title: 'Zine' }, 'Give at least one author'],
    ['only commas for authors', { title: 'Zine', authors: ' , ,' }, 'Give at least one author'],
    ['pages that are not a number', { title: 'Zine', authors: 'Cam', pages: '12x' }, 'Pages must be a whole number'],
    ['a year that is not a number', { title: 'Zine', authors: 'Cam', year: '19.5' }, 'Year must be a whole number'],
  ])('asks before sending anything for %s', async (_name, values, message) => {
    const api = renderAt('/p/p-2/add', {});
    const user = userEvent.setup();
    await fill(user, values);
    await submit(user);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(api.calls).toEqual([]);
  });

  it('shows the API’s message when saving the book fails, and keeps what was typed', async () => {
    const api = renderAt('/p/p-2/add', {
      AddManualBook: { errors: [{ message: 'Pages must be 1 to 20000', extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    const user = userEvent.setup();
    await fill(user, { title: 'Zine', authors: 'Cam', pages: '99999' });
    await submit(user);
    expect((await screen.findByRole('alert')).textContent).toContain('Pages must be 1 to 20000');
    expect(field(/^title/i).value).toBe('Zine');
    expect(api.calls.map((c) => c.operationName)).toEqual(['AddManualBook']);
  });

  it('does not save the book twice when only shelving failed and the reader tries again', async () => {
    const api = renderAt('/p/p-2/add', {
      AddManualBook: made,
      AddToShelf: [{ errors: [{ message: 'Profile or book not found' }] }, shelved],
    });
    const user = userEvent.setup();
    await fill(user, { title: 'Zine', authors: 'Cam' });
    await submit(user);
    expect((await screen.findByRole('alert')).textContent).toContain('Profile or book not found');
    await submit(user);
    expect((await screen.findByRole('status')).textContent).toBe('Added “Zine” to Want to read');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls.map((c) => c.operationName)).toEqual(['AddManualBook', 'AddToShelf', 'AddToShelf']);
  });

  it('treats the same details typed again after a successful add as a new book', async () => {
    const api = renderAt('/p/p-2/add', {
      AddManualBook: [made, { data: { addManualBook: { __typename: 'Book', id: 'book-10' } } }],
      AddToShelf: shelved,
    });
    const user = userEvent.setup();
    await fill(user, { title: 'Zine', authors: 'Cam' });
    await submit(user);
    await screen.findByRole('status');
    await fill(user, { title: 'Zine', authors: 'Cam' });
    await submit(user);
    await screen.findByRole('status');
    expect(api.calls.map((c) => c.operationName)).toEqual(['AddManualBook', 'AddToShelf', 'AddManualBook', 'AddToShelf']);
    expect(api.variables[3]).toEqual({ profileId: 'p-2', bookId: 'book-10', shelf: 'TO_READ' });
  });

  it('saves a new book when the details changed after a failed shelving', async () => {
    const api = renderAt('/p/p-2/add', {
      AddManualBook: [made, { data: { addManualBook: { __typename: 'Book', id: 'book-10' } } }],
      AddToShelf: [{ errors: [{ message: 'nope' }] }, shelved],
    });
    const user = userEvent.setup();
    await fill(user, { title: 'Zine', authors: 'Cam' });
    await submit(user);
    await screen.findByRole('alert');
    await user.type(field(/^title/i), ' 2');
    await submit(user);
    await screen.findByRole('status');
    expect(api.calls.map((c) => c.operationName)).toEqual(['AddManualBook', 'AddToShelf', 'AddManualBook', 'AddToShelf']);
    expect(api.variables[3]).toEqual({ profileId: 'p-2', bookId: 'book-10', shelf: 'TO_READ' });
  });

  it('is reached from the search page and links back', async () => {
    renderAt('/p/p-2/search', {});
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Add it yourself' }));
    expect(await screen.findByRole('heading', { name: 'Add a book yourself' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to search' }).getAttribute('href')).toBe('/p/p-2/search');
    expect(screen.getByRole('link', { name: 'Back to the shelves' }).getAttribute('href')).toBe('/p/p-2');
  });
});
