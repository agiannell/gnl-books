import { ApolloProvider } from '@apollo/client/react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import { createParentSession } from '../src/parentSession.ts';
import { ParentSessionProvider } from '../src/ParentSessionProvider.tsx';
import { routes } from '../src/routes.tsx';
import { fakeApi } from './fakeApi.ts';

const zone = (timezone: string) => ({ data: { family: { __typename: 'Family', id: 'f-1', timezone } } });
const saved = (timezone: string) => ({ data: { setTimezone: { __typename: 'Family', id: 'f-1', timezone } } });
const failure = (message: string) => ({ errors: [{ message }] });
const renewed = () => ({
  data: { renewParentUnlock: { __typename: 'ParentUnlock', token: 'parent', expiresAt: new Date(Date.now() + 600_000).toISOString() } },
});

const renderSettings = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi({
    SettingsProfiles: { data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [] } } },
    SettingsGoals: { data: { family: { __typename: 'Family', id: 'f-1', profiles: [] } } },
    SettingsJoinRequests: { data: { family: { __typename: 'Family', id: 'f-1', joinRequests: [] } } },
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

const section = async () => within(await screen.findByRole('region', { name: 'Time zone' }));
const picker = (s: ReturnType<typeof within>) => s.getByLabelText('Time zone') as HTMLSelectElement;
const saveButton = (s: ReturnType<typeof within>) => s.getByRole('button', { name: 'Save time zone' }) as HTMLButtonElement;
const calls = (api: ReturnType<typeof fakeApi>, name: string) => api.calls.filter((c) => c.operationName === name).length;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the time zone section of the settings', () => {
  it('starts on the family’s saved zone, among the world’s zones, with UTC and without underscores', async () => {
    const api = renderSettings({ SettingsTimezone: zone('America/New_York') });
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/New_York'));
    const options = [...picker(s).options];
    expect(options.length).toBeGreaterThan(300);
    expect(options.map((o) => o.value)).toContain('UTC');
    expect(options.find((o) => o.value === 'America/New_York')!.textContent).toBe('America/New York');
    expect(options.every((o) => !o.textContent!.includes('_'))).toBe(true);
    expect(calls(api, 'SettingsTimezone')).toBe(1);
  });

  it('says that changing the zone leaves saved dates alone', async () => {
    renderSettings({ SettingsTimezone: zone('America/Chicago') });
    expect(await (await section()).findByText(/does\s+not change dates already saved/)).toBeTruthy();
  });

  it('offers to save only when a different zone is chosen', async () => {
    renderSettings({ SettingsTimezone: zone('America/Chicago') });
    const user = userEvent.setup();
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
    expect(saveButton(s).disabled).toBe(true);
    await user.selectOptions(picker(s), 'Europe/Paris');
    expect(saveButton(s).disabled).toBe(false);
    await user.selectOptions(picker(s), 'America/Chicago');
    expect(saveButton(s).disabled).toBe(true);
  });

  it('saves the chosen zone and then shows it as the saved one', async () => {
    const api = renderSettings({
      SettingsTimezone: [zone('America/Chicago'), zone('Europe/Paris')],
      SetTimezone: saved('Europe/Paris'),
    });
    const user = userEvent.setup();
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
    await user.selectOptions(picker(s), 'Europe/Paris');
    await user.click(saveButton(s));
    await waitFor(() => expect(saveButton(s).disabled).toBe(true));
    expect(picker(s).value).toBe('Europe/Paris');
    const call = api.calls.findIndex((c) => c.operationName === 'SetTimezone');
    expect(api.variables[call]).toEqual({ timezone: 'Europe/Paris' });
    expect(calls(api, 'SettingsTimezone')).toBe(2);
  });

  it('can be set to UTC', async () => {
    const api = renderSettings({ SettingsTimezone: [zone('America/Chicago'), zone('UTC')], SetTimezone: saved('UTC') });
    const user = userEvent.setup();
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
    await user.selectOptions(picker(s), 'UTC');
    await user.click(saveButton(s));
    await waitFor(() => expect(calls(api, 'SetTimezone')).toBe(1));
    expect(api.variables[api.calls.findIndex((c) => c.operationName === 'SetTimezone')]).toEqual({ timezone: 'UTC' });
  });

  it('shows the API’s reason, keeps the choice, and leaves the saved zone alone', async () => {
    renderSettings({ SettingsTimezone: zone('America/Chicago'), SetTimezone: failure('Time zone not recognized') });
    const user = userEvent.setup();
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
    await user.selectOptions(picker(s), 'Europe/Paris');
    await user.click(saveButton(s));
    expect((await s.findByRole('alert')).textContent).toBe('Something went wrong: Time zone not recognized');
    expect(picker(s).value).toBe('Europe/Paris');
    expect(saveButton(s).disabled).toBe(false);
  });

  it('clears an earlier failure once a save works', async () => {
    renderSettings({
      SettingsTimezone: [zone('America/Chicago'), zone('Europe/Paris')],
      SetTimezone: [failure('nope'), saved('Europe/Paris')],
    });
    const user = userEvent.setup();
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
    await user.selectOptions(picker(s), 'Europe/Paris');
    await user.click(saveButton(s));
    await s.findByRole('alert');
    await user.click(saveButton(s));
    await waitFor(() => expect(s.queryByRole('alert')).toBeNull());
  });

  it('is off while the save is on its way', async () => {
    let release: (value: unknown) => void = () => {};
    const held = new Promise((resolve) => (release = resolve));
    renderSettings({ SettingsTimezone: [zone('America/Chicago'), zone('Europe/Paris')], SetTimezone: () => held });
    const user = userEvent.setup();
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
    await user.selectOptions(picker(s), 'Europe/Paris');
    await user.click(saveButton(s));
    await waitFor(() => expect(saveButton(s).disabled).toBe(true));
    release(saved('Europe/Paris'));
    await waitFor(() => expect(picker(s).value).toBe('Europe/Paris'));
  });

  it('offers a saved zone this browser does not know, so the picker still shows what is saved', async () => {
    renderSettings({ SettingsTimezone: zone('Etc/Brand_New_Zone') });
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('Etc/Brand_New_Zone'));
    expect([...picker(s).options][0]!.textContent).toBe('Etc/Brand New Zone');
  });

  it('asks again each time the settings open, and follows a zone someone else changed', async () => {
    const api = renderSettings({
      Me: { data: { me: { __typename: 'Account', familyId: 'f-1' } } },
      Family: { data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [] } } },
      SettingsTimezone: [zone('America/Chicago'), zone('Europe/Paris')],
    });
    const user = userEvent.setup();
    const s = await section();
    await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
    await user.click(screen.getByRole('link', { name: 'Back to who’s reading' }));
    await user.click(await screen.findByRole('link', { name: 'Parent settings' }));
    // It shows what it saw before, then what the API says now.
    const again = await section();
    await waitFor(() => expect(picker(again).value).toBe('Europe/Paris'));
    expect(calls(api, 'SettingsTimezone')).toBe(2);
  });

  describe('this device’s zone', () => {
    it('is not offered when this browser has no such zone in its list', async () => {
      // Valid for the system clock, but not one of the named zones the picker lists.
      vi.stubEnv('TZ', 'Etc/GMT+4');
      renderSettings({ SettingsTimezone: zone('America/Chicago') });
      const s = await section();
      await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Etc/GMT+4');
      expect(s.queryByText(/This device is set to/)).toBeNull();
    });

    it('is offered when it differs, and choosing it selects it without saving', async () => {
      vi.stubEnv('TZ', 'Asia/Tokyo');
      const api = renderSettings({ SettingsTimezone: zone('America/Chicago') });
      const user = userEvent.setup();
      const s = await section();
      await waitFor(() => expect(picker(s).value).toBe('America/Chicago'));
      expect(s.getByText(/This device is set to Asia\/Tokyo/)).toBeTruthy();
      await user.click(s.getByRole('button', { name: 'Use Asia/Tokyo' }));
      expect(picker(s).value).toBe('Asia/Tokyo');
      expect(saveButton(s).disabled).toBe(false);
      expect(calls(api, 'SetTimezone')).toBe(0);
      // Once it is the chosen zone the hint has nothing left to say.
      expect(s.queryByText(/This device is set to/)).toBeNull();
    });

    it('is not mentioned when it is already the saved zone', async () => {
      vi.stubEnv('TZ', 'Asia/Tokyo');
      renderSettings({ SettingsTimezone: zone('Asia/Tokyo') });
      const s = await section();
      await waitFor(() => expect(picker(s).value).toBe('Asia/Tokyo'));
      expect(s.queryByText(/This device is set to/)).toBeNull();
    });
  });

  it('shows the API’s message when the zone cannot be loaded', async () => {
    renderSettings({ SettingsTimezone: failure('Not authorized') });
    const s = await section();
    expect((await s.findByRole('alert')).textContent).toContain('Not authorized');
    expect(s.queryByLabelText('Time zone')).toBeNull();
  });
});
