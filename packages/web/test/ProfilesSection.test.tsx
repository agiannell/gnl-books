import { ApolloProvider } from '@apollo/client/react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import { createParentSession } from '../src/parentSession.ts';
import { ParentSessionProvider } from '../src/ParentSessionProvider.tsx';
import { routes } from '../src/routes.tsx';
import { fakeApi } from './fakeApi.ts';

// The first click after unlocking asks for a fresh token (the lock has its own tests), so the
// fake API answers that, and `names` leaves it out of the calls these tests are about.
const renewed = { data: { renewParentUnlock: { __typename: 'ParentUnlock', token: 'parent', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } } };

const renderAt = (path: string, handlers: Parameters<typeof fakeApi>[0]) => {
  // The goals section loads the same readers (both write the cached `family`), and the real API
  // sends the same ones to both, so its stand-in reply repeats the readers last sent to the other.
  let latest: { id: string; name: string }[] = [];
  const queue = [handlers.SettingsProfiles].flat().filter((reply) => reply !== undefined);
  const readersReply = queue.length
    ? {
        SettingsProfiles: () => {
          const reply = (queue.length > 1 ? queue.shift() : queue[0]) as { data?: { family?: { profiles?: typeof latest } } };
          latest = reply.data?.family?.profiles ?? [];
          return reply;
        },
      }
    : {};
  const api = fakeApi({ RenewParentUnlock: renewed, SettingsGoals: () => goalsFor(latest), ...handlers, ...readersReply });
  const session = createParentSession();
  // Already unlocked: the PIN screen has its own tests.
  session.set({ token: 'parent', expiresAt: Date.now() + 10 * 60_000 });
  const client = createApolloClient({ getAccessToken: async () => 'tok', getParentToken: session.getToken, fetch: api.fetch });
  const router = createMemoryRouter(routes[0]!.children!, { initialEntries: [path] });
  render(
    <ApolloProvider client={client}>
      <ParentSessionProvider session={session}>
        <RouterProvider router={router} />
      </ParentSessionProvider>
    </ApolloProvider>,
  );
  return api;
};

const reader = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  __typename: 'Profile',
  id,
  name,
  emoji: null,
  color: null,
  isParent: false,
  ...over,
});
const readers = (...profiles: unknown[]) => ({ data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles } } });
const failure = (message: string) => ({ errors: [{ message }] });
const created = { data: { createProfile: { __typename: 'Profile', id: 'p-9' } } };
const deleted = { data: { deleteProfile: true } };
// The goals section sits on the same page and loads on its own; its tests are in GoalsSection.test.tsx.
const goalsFor = (profiles: { id: string; name: string }[]) => ({
  data: {
    family: { __typename: 'Family', id: 'f-1', profiles: profiles.map((p) => ({ __typename: 'Profile', id: p.id, name: p.name, goal: null })) },
  },
});
const elsewhere = new Set(['RenewParentUnlock', 'SettingsGoals']);
const names = (api: ReturnType<typeof fakeApi>) => api.calls.map((c) => c.operationName).filter((name) => !elsewhere.has(name));
// The variables of the request at position `n` in `names(api)`.
const variablesOf = (api: ReturnType<typeof fakeApi>, n: number) => {
  let seen = -1;
  for (let i = 0; i < api.calls.length; i++) {
    if (elsewhere.has(api.calls[i]!.operationName)) continue;
    if (++seen === n) return api.variables[i];
  }
};

const PAT = reader('p-1', 'Pat', { isParent: true });
const SAM = reader('p-2', 'Sam', { emoji: '🦊' });

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const addReader = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Add reader' }));

describe('the readers section of the settings', () => {
  it('lists each reader with their emoji, and marks the parents', async () => {
    const api = renderAt('/settings', { SettingsProfiles: readers(PAT, SAM) });
    const section = await screen.findByRole('region', { name: 'Readers' });
    await within(section).findByText('Delete Sam');
    const items = within(section).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Pat (parent) Delete Pat',
      '🦊 Sam Delete Sam',
    ]);
    expect(names(api)).toEqual(['SettingsProfiles']);
  });

  describe('adding a reader', () => {
    it('sends what was entered, trimmed, and then shows the new list and empties the form', async () => {
      const api = renderAt('/settings', {
        SettingsProfiles: [readers(PAT), readers(PAT, reader('p-9', 'Kit', { emoji: '🐱' }))],
        CreateProfile: created,
      });
      const user = userEvent.setup();
      await screen.findByText('Delete Pat');
      await user.type(field(/^name/i), '  Kit ');
      await user.type(field(/^emoji/i), ' 🐱 ');
      await user.selectOptions(screen.getByLabelText('Colour'), 'Blue');
      await addReader(user);
      expect(await screen.findByText('Delete Kit')).toBeTruthy();
      expect(variablesOf(api, 1)).toEqual({ input: { name: 'Kit', emoji: '🐱', color: '#3366cc', isParent: false } });
      expect([field(/^name/i).value, field(/^emoji/i).value]).toEqual(['', '']);
      expect((screen.getByLabelText('Colour') as HTMLSelectElement).value).toBe('');
    });

    it('sends null for an empty emoji and no colour, and passes on "this reader is a parent"', async () => {
      const api = renderAt('/settings', { SettingsProfiles: [readers(PAT), readers(PAT)], CreateProfile: created });
      const user = userEvent.setup();
      await screen.findByText('Delete Pat');
      await user.type(field(/^name/i), 'Lee');
      await user.click(screen.getByLabelText(/this reader is a parent/i));
      await addReader(user);
      await waitFor(() => expect(names(api)).toContain('CreateProfile'));
      expect(variablesOf(api, 1)).toEqual({ input: { name: 'Lee', emoji: null, color: null, isParent: true } });
      await waitFor(() => expect((screen.getByLabelText(/this reader is a parent/i) as HTMLInputElement).checked).toBe(false));
    });

    it('wants a name before it sends anything', async () => {
      const api = renderAt('/settings', { SettingsProfiles: readers(PAT) });
      const user = userEvent.setup();
      await screen.findByText('Delete Pat');
      await user.type(field(/^name/i), '   ');
      await addReader(user);
      expect((await screen.findByRole('alert')).textContent).toBe('Give the reader a name');
      expect(names(api)).toEqual(['SettingsProfiles']);
    });

    it('counts an emoji in characters, as the API does', async () => {
      const api = renderAt('/settings', { SettingsProfiles: [readers(PAT), readers(PAT)], CreateProfile: created });
      const user = userEvent.setup();
      await screen.findByText('Delete Pat');
      await user.type(field(/^name/i), 'Kit');
      // Nine emoji are too many, however they are counted.
      await user.type(field(/^emoji/i), '🦊'.repeat(9));
      await addReader(user);
      expect((await screen.findByRole('alert')).textContent).toBe('Emoji must be at most 8 characters');
      expect(names(api)).not.toContain('CreateProfile');
      // A family emoji is seven characters but eleven UTF-16 units: it must be accepted.
      await user.clear(field(/^emoji/i));
      await user.type(field(/^emoji/i), '👨‍👩‍👧‍👦');
      await addReader(user);
      await waitFor(() => expect(names(api)).toContain('CreateProfile'));
      expect((variablesOf(api, names(api).indexOf('CreateProfile')) as { input: { emoji: string } }).input.emoji).toBe('👨‍👩‍👧‍👦');
    });

    it('shows the API’s reason, such as the limit, and keeps what was typed', async () => {
      renderAt('/settings', {
        SettingsProfiles: readers(PAT),
        CreateProfile: failure('A family can have at most 20 profiles'),
      });
      const user = userEvent.setup();
      await screen.findByText('Delete Pat');
      await user.type(field(/^name/i), 'Kit');
      await addReader(user);
      expect((await screen.findByRole('alert')).textContent).toContain('at most 20 profiles');
      expect(field(/^name/i).value).toBe('Kit');
    });

    it('clears an earlier problem once the next try works', async () => {
      renderAt('/settings', {
        SettingsProfiles: [readers(PAT), readers(PAT)],
        CreateProfile: [failure('nope'), created],
      });
      const user = userEvent.setup();
      await screen.findByText('Delete Pat');
      await user.type(field(/^name/i), 'Kit');
      await addReader(user);
      await screen.findByRole('alert');
      await addReader(user);
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
  });

  describe('deleting a reader', () => {
    it('asks first, and does nothing if the parent keeps them', async () => {
      const api = renderAt('/settings', { SettingsProfiles: readers(PAT, SAM) });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete Sam' }));
      expect(screen.getByText('Delete Sam and all their books? This cannot be undone.')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Keep Sam' }));
      expect(screen.queryByText(/cannot be undone/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Delete Sam' })).toBeTruthy();
      expect(names(api)).toEqual(['SettingsProfiles']);
    });

    it('deletes the reader that was confirmed, then shows the new list', async () => {
      const api = renderAt('/settings', {
        SettingsProfiles: [readers(PAT, SAM), readers(PAT)],
        DeleteProfile: deleted,
      });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete Sam' }));
      await user.click(screen.getByRole('button', { name: 'Yes, delete Sam' }));
      await waitFor(() => expect(screen.queryByText('Delete Sam')).toBeNull());
      expect(variablesOf(api, 1)).toEqual({ profileId: 'p-2' });
      expect(names(api)).toEqual(['SettingsProfiles', 'DeleteProfile', 'SettingsProfiles']);
      expect(screen.queryByText(/cannot be undone/)).toBeNull();
    });

    it('has one confirmation open at a time', async () => {
      renderAt('/settings', { SettingsProfiles: readers(PAT, SAM) });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete Sam' }));
      await user.click(screen.getByRole('button', { name: 'Delete Pat' }));
      expect(screen.getAllByText(/cannot be undone/)).toHaveLength(1);
      expect(screen.getByText('Delete Pat and all their books? This cannot be undone.')).toBeTruthy();
    });

    it('cannot delete the only reader', async () => {
      renderAt('/settings', { SettingsProfiles: readers(PAT) });
      const button = (await screen.findByRole('button', { name: 'Delete Pat' })) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('shows the API’s reason when the delete is refused, and leaves the question open', async () => {
      renderAt('/settings', {
        SettingsProfiles: readers(PAT, SAM),
        DeleteProfile: failure('A family needs at least one profile'),
      });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Delete Sam' }));
      await user.click(screen.getByRole('button', { name: 'Yes, delete Sam' }));
      expect((await screen.findByRole('alert')).textContent).toContain('at least one profile');
      expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    });
  });

  it('sends the parent token with the changes', async () => {
    const seen: (string | null)[] = [];
    const api = fakeApi({ RenewParentUnlock: renewed, SettingsGoals: goalsFor([PAT]), SettingsProfiles: [readers(PAT), readers(PAT)], CreateProfile: created });
    const session = createParentSession();
    session.set({ token: 'parent', expiresAt: Date.now() + 600_000 });
    const client = createApolloClient({
      getAccessToken: async () => 'tok',
      getParentToken: session.getToken,
      fetch: ((url: unknown, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get('x-parent-token'));
        return api.fetch(url as string, init);
      }) as typeof fetch,
    });
    render(
      <ApolloProvider client={client}>
        <ParentSessionProvider session={session}>
          <RouterProvider router={createMemoryRouter(routes[0]!.children!, { initialEntries: ['/settings'] })} />
        </ParentSessionProvider>
      </ApolloProvider>,
    );
    const user = userEvent.setup();
    await screen.findByText('Delete Pat');
    await user.type(field(/^name/i), 'Kit');
    await addReader(user);
    await waitFor(() => expect(names(api)).toContain('CreateProfile'));
    expect(seen.every((token) => token === 'parent')).toBe(true);
  });

  it('asks for the readers again each time the settings open, so a change made elsewhere shows', async () => {
    const summary = (id: string, name: string) => ({ __typename: 'Profile', id, name, emoji: null, color: null });
    renderAt('/settings', {
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: { data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [summary('p-1', 'Pat')] } } },
      SettingsProfiles: [readers(PAT), readers(PAT, reader('p-9', 'Kit'))],
    });
    const user = userEvent.setup();
    await screen.findByText('Delete Pat');
    expect(screen.queryByText('Delete Kit')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Back to who’s reading' }));
    await user.click(await screen.findByRole('link', { name: 'Parent settings' }));
    expect(await screen.findByText('Delete Kit')).toBeTruthy();
  });

  it('shows the API’s message when the readers cannot be loaded', async () => {
    renderAt('/settings', { SettingsProfiles: failure('Not authorized') });
    expect((await screen.findByRole('alert')).textContent).toContain('Not authorized');
  });

  it('shows a new reader on the “who’s reading” screen when the parent goes back', async () => {
    const profileSummary = (id: string, name: string) => ({ __typename: 'Profile', id, name, emoji: null, color: null });
    renderAt('/', {
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: [
        { data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [profileSummary('p-1', 'Pat')] } } },
        { data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [profileSummary('p-1', 'Pat'), profileSummary('p-9', 'Kit')] } } },
      ],
      SettingsProfiles: [readers(PAT), readers(PAT, reader('p-9', 'Kit'))],
      CreateProfile: created,
    });
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Pat' });
    await user.click(screen.getByRole('link', { name: 'Parent settings' }));
    await user.type(await screen.findByLabelText(/^name/i), 'Kit');
    await addReader(user);
    await screen.findByText('Delete Kit');
    await user.click(screen.getByRole('link', { name: 'Back to who’s reading' }));
    expect(await screen.findByRole('link', { name: 'Kit' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pat' })).toBeTruthy();
  });
});
