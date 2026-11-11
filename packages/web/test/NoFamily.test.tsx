import { ApolloProvider } from '@apollo/client/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import Home from '../src/Home.tsx';
import { fakeApi } from './fakeApi.ts';

const noFamily = { data: { me: { __typename: 'Account', familyId: null } } };
const inFamily = { data: { me: { __typename: 'Account', familyId: 'f-1' } } };
const family = {
  data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [{ __typename: 'Profile', id: 'p-1', name: 'Pat', emoji: null, color: null }] } },
};
const failure = (message: string) => ({ errors: [{ message }] });

const renderHome = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi({ Me: noFamily, ...handlers });
  const client = createApolloClient({ getAccessToken: async () => 'tok', fetch: api.fetch });
  render(
    <MemoryRouter>
      <ApolloProvider client={client}>
        <Home />
      </ApolloProvider>
    </MemoryRouter>,
  );
  return api;
};

const requests = (api: ReturnType<typeof fakeApi>) =>
  api.calls.flatMap((c, i) => (c.operationName === 'RequestToJoin' ? [api.variables[i]] : []));

const openJoin = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Join someone else’s family instead' }));
  return user;
};
const ask = async (user: ReturnType<typeof userEvent.setup>, email: string) => {
  if (email) await user.type(screen.getByLabelText('Parent’s email'), email);
  await user.click(screen.getByRole('button', { name: 'Ask to join' }));
};

describe('a signed-in user with no family', () => {
  it('is offered setting up a family first, with a way to join one instead', async () => {
    renderHome({});
    expect(await screen.findByRole('heading', { name: 'Set up your family' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join someone else’s family instead' })).toBeTruthy();
  });

  it('asks for a parent’s email when they choose to join', async () => {
    renderHome({});
    await openJoin();
    expect(screen.getByRole('heading', { name: 'Join a family' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Set up your family' })).toBeNull();
  });

  it('can go back to setting up their own family', async () => {
    renderHome({});
    const user = await openJoin();
    await user.click(screen.getByRole('button', { name: 'Set up my own family instead' }));
    expect(await screen.findByRole('heading', { name: 'Set up your family' })).toBeTruthy();
  });

  it('sends the parent’s email, trimmed, and says what happens next', async () => {
    const api = renderHome({ RequestToJoin: { data: { requestToJoin: true } } });
    const user = await openJoin();
    await ask(user, '  parent@example.test ');
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeTruthy();
    expect(requests(api)).toEqual([{ parentEmail: 'parent@example.test' }]);
    expect(document.body.textContent).toContain('If parent@example.test belongs to a family, a parent can now approve you');
  });

  // The API answers the same for an email that belongs to no family, so the page must not hint at it.
  it('says the same thing whatever the email, so it cannot be used to find families', async () => {
    renderHome({ RequestToJoin: { data: { requestToJoin: true } } });
    const user = await openJoin();
    await ask(user, 'nobody-at-all@example.test');
    await screen.findByRole('heading', { name: 'Request sent' });
    const page = document.body.textContent ?? '';
    expect(page).toContain('If nobody-at-all@example.test belongs to a family');
    expect(page).not.toMatch(/not found|no family|doesn.t exist|unknown/i);
  });

  it.each(['', '   ', 'no-at-sign', 'a@b', 'two words@example.test'])('catches the typo %j before asking the API', async (email) => {
    const api = renderHome({});
    const user = await openJoin();
    await ask(user, email);
    expect((await screen.findByRole('alert')).textContent).toContain('email address of a parent');
    expect(requests(api)).toEqual([]);
  });

  it('shows the API’s reason when the request is refused, and keeps the email typed', async () => {
    renderHome({ RequestToJoin: failure('Verify your email address before asking to join a family') });
    const user = await openJoin();
    await ask(user, 'parent@example.test');
    expect((await screen.findByRole('alert')).textContent).toContain('Verify your email address');
    expect((screen.getByLabelText('Parent’s email') as HTMLInputElement).value).toBe('parent@example.test');
  });

  it('lets them try another email after sending one', async () => {
    renderHome({ RequestToJoin: { data: { requestToJoin: true } } });
    const user = await openJoin();
    await ask(user, 'first@example.test');
    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(screen.getByRole('heading', { name: 'Join a family' })).toBeTruthy();
  });

  it('shows the family once a parent has approved them and they check again', async () => {
    const api = renderHome({
      Me: [noFamily, noFamily, inFamily],
      RequestToJoin: { data: { requestToJoin: true } },
      Family: family,
    });
    const user = await openJoin();
    await ask(user, 'parent@example.test');
    await user.click(await screen.findByRole('button', { name: 'Check again' }));
    // Not approved yet: still waiting.
    await waitFor(() => expect(api.calls.filter((c) => c.operationName === 'Me')).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Request sent' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('heading', { name: 'Who’s reading?' })).toBeTruthy();
  });

  it('can give up waiting and set up their own family', async () => {
    renderHome({ RequestToJoin: { data: { requestToJoin: true } } });
    const user = await openJoin();
    await ask(user, 'parent@example.test');
    await user.click(await screen.findByRole('button', { name: 'Set up my own family instead' }));
    expect(await screen.findByRole('heading', { name: 'Set up your family' })).toBeTruthy();
  });
});
