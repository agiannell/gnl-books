import { ApolloProvider } from '@apollo/client/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import Home from '../src/Home.tsx';
import { fakeApi } from './fakeApi.ts';

const noFamily = { data: { me: { __typename: 'Account', familyId: null } } };
const hasFamily = { data: { me: { __typename: 'Account', familyId: 'f-1' } } };
const family = {
  data: {
    family: {
      __typename: 'Family',
      id: 'f-1',
      name: 'The Gnls',
      profiles: [{ __typename: 'Profile', id: 'p-1', name: 'Pat', emoji: null, color: null }],
    },
  },
};

// Home is what a person with no family sees, so the form is tested inside it.
const renderHome = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(handlers);
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

const fill = (labels: Record<string, string>) => {
  for (const [label, value] of Object.entries(labels)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
};
const valid = { 'Family name': 'The Gnls', 'Your name': 'Pat', 'Parent PIN': '4821', 'Parent PIN again': '4821' };
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create family' }));
const sentCreate = (api: ReturnType<typeof fakeApi>) => api.calls.some((c) => c.operationName === 'CreateFamily');

describe('setting up a family', () => {
  it('asks a signed-in user with no family to set one up', async () => {
    renderHome({ Me: noFamily });
    expect(await screen.findByRole('heading', { name: 'Set up your family' })).toBeTruthy();
  });

  it('sends the trimmed names and the PIN, then shows the new family without a reload', async () => {
    const api = renderHome({
      Me: [noFamily, hasFamily],
      Family: family,
      CreateFamily: { data: { createFamily: { __typename: 'Family', id: 'f-1' } } },
    });
    await screen.findByRole('heading', { name: 'Set up your family' });
    fill({ ...valid, 'Family name': '  The Gnls ', 'Your name': ' Pat  ' });
    submit();
    expect(await screen.findByRole('heading', { name: 'Who’s reading?' })).toBeTruthy();
    const i = api.calls.findIndex((c) => c.operationName === 'CreateFamily');
    expect(api.variables[i]).toEqual({ familyName: 'The Gnls', parentName: 'Pat', pin: '4821' });
    expect(api.calls[i]?.authorization).toBe('Bearer tok');
    expect(screen.queryByRole('heading', { name: 'Set up your family' })).toBeNull();
  });

  it.each([
    ['a blank family name', { 'Family name': '   ' }, /Family name must be/],
    ['a blank name', { 'Your name': '' }, /Your name must be/],
    ['a PIN of 3 digits', { 'Parent PIN': '123', 'Parent PIN again': '123' }, /4 to 8 digits/],
    ['a PIN with letters', { 'Parent PIN': '12a4', 'Parent PIN again': '12a4' }, /4 to 8 digits/],
    ['PINs that differ', { 'Parent PIN again': '4822' }, /do not match/],
  ])('refuses %s without asking the API', async (_name, change, message) => {
    const api = renderHome({ Me: noFamily });
    await screen.findByRole('heading', { name: 'Set up your family' });
    fill({ ...valid, ...change });
    submit();
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(sentCreate(api)).toBe(false);
  });

  it('shows what the server says when it refuses, and keeps what was typed', async () => {
    renderHome({
      Me: noFamily,
      CreateFamily: { errors: [{ message: 'Family name must be 1 to 60 characters', extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    await screen.findByRole('heading', { name: 'Set up your family' });
    fill(valid);
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Family name must be 1 to 60 characters');
    expect((screen.getByLabelText('Family name') as HTMLInputElement).value).toBe('The Gnls');
    expect((screen.getByLabelText('Parent PIN') as HTMLInputElement).value).toBe('4821');
  });

  it('looks again when the server says the family already exists', async () => {
    const api = renderHome({
      Me: [noFamily, hasFamily],
      Family: family,
      CreateFamily: { errors: [{ message: 'You already have a family', extensions: { code: 'CONFLICT' } }] },
    });
    await screen.findByRole('heading', { name: 'Set up your family' });
    fill(valid);
    submit();
    expect(await screen.findByRole('heading', { name: 'Who’s reading?' })).toBeTruthy();
    expect(api.calls.filter((c) => c.operationName === 'Me')).toHaveLength(2);
  });

  it('does not send twice while the first request is in flight', async () => {
    const api = renderHome({
      Me: [noFamily, hasFamily],
      Family: family,
      CreateFamily: { data: { createFamily: { __typename: 'Family', id: 'f-1' } } },
    });
    await screen.findByRole('heading', { name: 'Set up your family' });
    fill(valid);
    const button = screen.getByRole('button', { name: 'Create family' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Set up your family' })).toBeNull());
    expect(api.calls.filter((c) => c.operationName === 'CreateFamily')).toHaveLength(1);
  });

  it('limits the names to 60 characters and the PIN to 8, so nothing longer can be typed', async () => {
    renderHome({ Me: noFamily });
    await screen.findByRole('heading', { name: 'Set up your family' });
    const max = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).maxLength;
    expect([max('Family name'), max('Your name'), max('Parent PIN'), max('Parent PIN again')]).toEqual([60, 60, 8, 8]);
  });

  it('hides the PINs as they are typed', async () => {
    renderHome({ Me: noFamily });
    await screen.findByRole('heading', { name: 'Set up your family' });
    expect((screen.getByLabelText('Parent PIN') as HTMLInputElement).type).toBe('password');
    expect((screen.getByLabelText('Parent PIN again') as HTMLInputElement).type).toBe('password');
  });
});
