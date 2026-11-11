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

const request = (id: string, email: string, requestedAt = '2026-11-11T12:00:00.000Z') => ({
  __typename: 'JoinRequest',
  id,
  email,
  requestedAt,
});
const requests = (...items: ReturnType<typeof request>[]) => ({
  data: { family: { __typename: 'Family', id: 'f-1', joinRequests: items } },
});
const failure = (message: string) => ({ errors: [{ message }] });
const renewed = () => ({
  data: { renewParentUnlock: { __typename: 'ParentUnlock', token: 'parent', expiresAt: new Date(Date.now() + 600_000).toISOString() } },
});

const renderSettings = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi({
    SettingsProfiles: { data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [] } } },
    SettingsGoals: { data: { family: { __typename: 'Family', id: 'f-1', profiles: [] } } },
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

const section = async () => within(await screen.findByRole('region', { name: 'Join requests' }));
const sent = (api: ReturnType<typeof fakeApi>, name: string) =>
  api.calls.flatMap((c, i) => (c.operationName === name ? [api.variables[i]] : []));

describe('the join requests section of the settings', () => {
  it('says so when no one is waiting, and warns what approving gives', async () => {
    renderSettings({ SettingsJoinRequests: requests() });
    const s = await section();
    expect(await s.findByText('No one is waiting to join.')).toBeTruthy();
    expect(s.getByText(/Only approve people you know/)).toBeTruthy();
    expect(s.queryByRole('button')).toBeNull();
  });

  it('lists who is asking, by their email, with when', async () => {
    renderSettings({
      SettingsJoinRequests: requests(
        request('r-1', 'alex@example.test', '2026-11-11T18:00:00.000Z'),
        request('r-2', 'recruiter@example.test', '2026-11-12T18:00:00.000Z'),
      ),
    });
    const s = await section();
    expect(await s.findByText('alex@example.test')).toBeTruthy();
    expect(s.getByText('recruiter@example.test')).toBeTruthy();
    expect(s.getByText('Asked on Nov 11, 2026')).toBeTruthy();
    expect(s.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Approve alex@example.test',
      'Deny alex@example.test',
      'Approve recruiter@example.test',
      'Deny recruiter@example.test',
    ]);
  });

  it('approves the request that was chosen, then shows what is left', async () => {
    const api = renderSettings({
      SettingsJoinRequests: [
        requests(request('r-1', 'alex@example.test'), request('r-2', 'recruiter@example.test')),
        requests(request('r-2', 'recruiter@example.test')),
      ],
      ApproveJoinRequest: { data: { approveJoinRequest: true } },
    });
    const s = await section();
    await userEvent.setup().click(await s.findByRole('button', { name: 'Approve alex@example.test' }));
    await waitFor(() => expect(s.queryByText('alex@example.test')).toBeNull());
    expect(sent(api, 'ApproveJoinRequest')).toEqual([{ requestId: 'r-1' }]);
    expect(s.getByText('recruiter@example.test')).toBeTruthy();
  });

  it('denies the request that was chosen, and never approves it', async () => {
    const api = renderSettings({
      SettingsJoinRequests: [requests(request('r-1', 'alex@example.test')), requests()],
      DenyJoinRequest: { data: { denyJoinRequest: true } },
    });
    const s = await section();
    await userEvent.setup().click(await s.findByRole('button', { name: 'Deny alex@example.test' }));
    expect(await s.findByText('No one is waiting to join.')).toBeTruthy();
    expect(sent(api, 'DenyJoinRequest')).toEqual([{ requestId: 'r-1' }]);
    expect(sent(api, 'ApproveJoinRequest')).toEqual([]);
  });

  it('shows the API’s reason when it refuses, and keeps the request on the list', async () => {
    renderSettings({
      SettingsJoinRequests: requests(request('r-1', 'alex@example.test')),
      ApproveJoinRequest: failure('Request not found'),
    });
    const s = await section();
    await userEvent.setup().click(await s.findByRole('button', { name: 'Approve alex@example.test' }));
    expect((await s.findByRole('alert')).textContent).toContain('Request not found');
    expect(s.getByText('alex@example.test')).toBeTruthy();
  });

  it('shows the API’s message when the requests cannot be loaded', async () => {
    renderSettings({ SettingsJoinRequests: failure('Not authorized') });
    const s = await section();
    expect((await s.findByRole('alert')).textContent).toContain('Not authorized');
  });
});
