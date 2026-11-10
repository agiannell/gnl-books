import { ApolloProvider } from '@apollo/client/react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import { createParentSession } from '../src/parentSession.ts';
import { ParentSessionProvider } from '../src/ParentSessionProvider.tsx';
import { routes } from '../src/routes.tsx';
import { fakeApi } from './fakeApi.ts';

const reader = (id: string, name: string) => ({ __typename: 'Profile', id, name, emoji: null, color: null, isParent: false });
const readers = (...profiles: unknown[]) => ({ data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles } } });
const PAT = reader('p-1', 'Pat');
const SAM = reader('p-2', 'Sam');
const noGoals = (...profiles: { id: string; name: string }[]) => ({
  data: {
    family: {
      __typename: 'Family',
      id: 'f-1',
      profiles: profiles.map((p) => ({ __typename: 'Profile', id: p.id, name: p.name, goal: null })),
    },
  },
});
const renewed = () => ({
  data: { renewParentUnlock: { __typename: 'ParentUnlock', token: 'parent', expiresAt: new Date(Date.now() + 600_000).toISOString() } },
});
const csvReply = (csv: string) => ({ data: { exportGoodreadsCsv: csv } });
const failure = (message: string) => ({ errors: [{ message }] });

const renderSettings = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi({
    SettingsProfiles: readers(PAT, SAM),
    SettingsGoals: noGoals({ id: 'p-1', name: 'Pat' }, { id: 'p-2', name: 'Sam' }),
    SettingsTimezone: { data: { family: { __typename: 'Family', id: 'f-1', timezone: 'America/Chicago' } } },
    RenewParentUnlock: renewed,
    ...handlers,
  });
  const session = createParentSession();
  session.set({ token: 'parent', expiresAt: Date.now() + 600_000 });
  const client = createApolloClient({ getAccessToken: async () => 'tok', getParentToken: session.getToken, fetch: api.fetch });
  const router = createMemoryRouter(routes[0]!.children!, { initialEntries: ['/settings'] });
  render(
    <ApolloProvider client={client}>
      <ParentSessionProvider session={session}>
        <RouterProvider router={router} />
      </ParentSessionProvider>
    </ApolloProvider>,
  );
  return api;
};

const section = async () => within(await screen.findByRole('region', { name: 'Export books' }));

// What the browser was asked to save.
let saved: { download: string; text: Promise<string>; type: string }[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  saved = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:fake-${++n}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    // A link click inside the page would navigate; only downloads are expected here.
    const blob = blobs.get(this.href)!;
    saved.push({ download: this.download, text: blob.text(), type: blob.type });
  });
});
afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

describe('the export section of the settings', () => {
  it('offers one download per reader', async () => {
    renderSettings({});
    const s = await section();
    expect(await s.findByRole('button', { name: 'Download books for Pat' })).toBeTruthy();
    expect(s.getByRole('button', { name: 'Download books for Sam' })).toBeTruthy();
    expect(s.getAllByRole('listitem')).toHaveLength(2);
  });

  it('asks the API for that reader’s file, and saves it under their name, exactly as sent', async () => {
    const csv = 'Title,Author\r\n"Dog Man, Vol. 1","Pilkey, Dav"\r\nÜnï,"say ""hi"""\n';
    const api = renderSettings({ ExportGoodreadsCsv: csvReply(csv) });
    const user = userEvent.setup();
    const s = await section();
    await user.click(await s.findByRole('button', { name: 'Download books for Sam' }));
    expect((await s.findByRole('status')).textContent).toBe('Downloading sam-books.csv');
    const call = api.calls.findIndex((c) => c.operationName === 'ExportGoodreadsCsv');
    expect(api.variables[call]).toEqual({ profileId: 'p-2' });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.download).toBe('sam-books.csv');
    expect(saved[0]!.type).toBe('text/csv;charset=utf-8');
    expect(await saved[0]!.text).toBe(csv);
  });

  it('saves a file even when the reader has no books yet (just the header)', async () => {
    renderSettings({ ExportGoodreadsCsv: csvReply('Title,Author\n') });
    const user = userEvent.setup();
    await user.click(await (await section()).findByRole('button', { name: 'Download books for Pat' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(await saved[0]!.text).toBe('Title,Author\n');
  });

  it('names the file from a name with spaces or accents', async () => {
    renderSettings({
      SettingsProfiles: readers(reader('p-3', 'José María')),
      SettingsGoals: noGoals({ id: 'p-3', name: 'José María' }),
      ExportGoodreadsCsv: csvReply('x'),
    });
    const user = userEvent.setup();
    await user.click(await (await section()).findByRole('button', { name: 'Download books for José María' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.download).toBe('jose-maria-books.csv');
  });

  it('shows the API’s reason and saves nothing when the export fails, then lets the parent try again', async () => {
    renderSettings({ ExportGoodreadsCsv: [failure('Profile not found'), csvReply('ok\n')] });
    const user = userEvent.setup();
    const s = await section();
    await user.click(await s.findByRole('button', { name: 'Download books for Pat' }));
    expect((await s.findByRole('alert')).textContent).toBe('Something went wrong: Profile not found');
    expect(saved).toEqual([]);
    await user.click(s.getByRole('button', { name: 'Download books for Pat' }));
    expect((await s.findByRole('status')).textContent).toBe('Downloading pat-books.csv');
    expect(s.queryByRole('alert')).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it('clears the "Downloading" message when the next export fails', async () => {
    renderSettings({ ExportGoodreadsCsv: [csvReply('ok\n'), failure('nope')] });
    const user = userEvent.setup();
    const s = await section();
    await user.click(await s.findByRole('button', { name: 'Download books for Pat' }));
    await s.findByRole('status');
    await user.click(s.getByRole('button', { name: 'Download books for Sam' }));
    await s.findByRole('alert');
    expect(s.queryByRole('status')).toBeNull();
  });

  it('stops showing the last download while the next one is being fetched', async () => {
    let release: (value: unknown) => void = () => {};
    const held = new Promise((resolve) => (release = resolve));
    renderSettings({ ExportGoodreadsCsv: [csvReply('ok\n'), () => held] });
    const user = userEvent.setup();
    const s = await section();
    await user.click(await s.findByRole('button', { name: 'Download books for Pat' }));
    await s.findByText('Downloading pat-books.csv');
    await user.click(s.getByRole('button', { name: 'Download books for Sam' }));
    await waitFor(() => expect((s.getByRole('button', { name: 'Download books for Pat' }) as HTMLButtonElement).disabled).toBe(true));
    expect(s.queryByRole('status')).toBeNull();
    release(csvReply('ok\n'));
    expect(await s.findByText('Downloading sam-books.csv')).toBeTruthy();
  });

  it('treats a reply with no file as a failure, and saves nothing', async () => {
    renderSettings({ ExportGoodreadsCsv: { data: null } });
    const user = userEvent.setup();
    const s = await section();
    await user.click(await s.findByRole('button', { name: 'Download books for Pat' }));
    expect((await s.findByRole('alert')).textContent).toBe('Something went wrong: The API sent no file');
    expect(saved).toEqual([]);
  });

  it('waits for one export to finish before another can start', async () => {
    let release: (value: unknown) => void = () => {};
    const held = new Promise((resolve) => (release = resolve));
    const api = renderSettings({ ExportGoodreadsCsv: () => held });
    const user = userEvent.setup();
    const s = await section();
    await user.click(await s.findByRole('button', { name: 'Download books for Pat' }));
    await waitFor(() => expect((s.getByRole('button', { name: 'Download books for Sam' }) as HTMLButtonElement).disabled).toBe(true));
    await user.click(s.getByRole('button', { name: 'Download books for Sam' }));
    expect(api.calls.filter((c) => c.operationName === 'ExportGoodreadsCsv')).toHaveLength(1);
    release(csvReply('ok\n'));
    await waitFor(() => expect((s.getByRole('button', { name: 'Download books for Sam' }) as HTMLButtonElement).disabled).toBe(false));
    expect(saved).toHaveLength(1);
  });

  it('shows the API’s message when the readers cannot be loaded', async () => {
    renderSettings({ SettingsProfiles: failure('Not authorized') });
    const s = await section();
    expect((await s.findByRole('alert')).textContent).toContain('Not authorized');
    expect(s.queryByRole('button')).toBeNull();
  });
});
