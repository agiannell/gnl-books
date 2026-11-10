import { ApolloProvider } from '@apollo/client/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApolloClient } from '../src/apollo.ts';
import { createParentSession } from '../src/parentSession.ts';
import { ParentSessionProvider } from '../src/ParentSessionProvider.tsx';
import { routes } from '../src/routes.tsx';
import { fakeApi } from './fakeApi.ts';

// A page that sends one request, to see which headers it carries.
const ME = { data: { me: { __typename: 'Account', familyId: 'f-1' } } };

// The settings page loads the readers once unlocked; these tests are about the lock, so it is an empty family.
const readers = { data: { family: { __typename: 'Family', name: 'The Gnls', profiles: [] } } };
const parentCalls = (api: ReturnType<typeof fakeApi>) =>
  api.calls.map((c) => c.operationName).filter((name) => /Parent/.test(name));

const renderSettings = (handlers: Parameters<typeof fakeApi>[0], session = createParentSession()) => {
  const api = fakeApi({ SettingsProfiles: readers, ...handlers });
  const client = createApolloClient({
    getAccessToken: async () => 'tok',
    getParentToken: session.getToken,
    fetch: api.fetch,
  });
  const router = createMemoryRouter(routes[0]!.children!, { initialEntries: ['/settings'] });
  render(
    <ApolloProvider client={client}>
      <ParentSessionProvider session={session}>
        <RouterProvider router={router} />
      </ParentSessionProvider>
    </ApolloProvider>,
  );
  return { api, session };
};

const unlockReply = (token = 'parent-1', expiresAt = new Date(Date.now() + 120_000).toISOString()) => ({
  data: { unlockParent: { __typename: 'ParentUnlock', token, expiresAt } },
});
const renewReply = (token: string, expiresAt = new Date(Date.now() + 120_000).toISOString()) => ({
  data: { renewParentUnlock: { __typename: 'ParentUnlock', token, expiresAt } },
});
const failure = (code: string, message: string, extensions: Record<string, unknown> = {}) => ({
  errors: [{ message, extensions: { code, ...extensions } }],
});

const pinBox = () => screen.getByLabelText('Parent PIN') as HTMLInputElement;
const enterPin = async (user: ReturnType<typeof userEvent.setup>, pin: string) => {
  await user.type(pinBox(), pin);
  await user.click(screen.getByRole('button', { name: 'Unlock' }));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the parent session store', () => {
  it('holds the unlock in memory and tells listeners when it changes', () => {
    const session = createParentSession();
    const seen: (string | undefined)[] = [];
    const stop = session.subscribe(() => seen.push(session.getToken()));
    expect(session.getToken()).toBeUndefined();
    session.set({ token: 'a', expiresAt: 1 });
    session.set(null);
    stop();
    session.set({ token: 'b', expiresAt: 1 });
    expect(seen).toEqual(['a', undefined]);
    expect(session.getToken()).toBe('b');
  });

  it('keeps the token out of web storage', () => {
    createParentSession().set({ token: 'secret-token', expiresAt: 1 });
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-token');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-token');
  });
});

describe('the API client and the parent token', () => {
  it('sends the parent token in X-Parent-Token only while there is one', async () => {
    const session = createParentSession();
    const seen: (string | null)[] = [];
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('x-parent-token'));
      return new Response(JSON.stringify(ME), { headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const client = createApolloClient({ getAccessToken: async () => 'tok', getParentToken: session.getToken, fetch });
    const { ME: query } = await import('../src/queries.ts');
    await client.query({ query, fetchPolicy: 'network-only' });
    session.set({ token: 'p-1', expiresAt: Date.now() + 1000 });
    await client.query({ query, fetchPolicy: 'network-only' });
    session.set(null);
    await client.query({ query, fetchPolicy: 'network-only' });
    expect(seen).toEqual([null, 'p-1', null]);
  });

  it('still sends the bearer token alongside the parent token', async () => {
    const session = createParentSession();
    session.set({ token: 'p-1', expiresAt: Date.now() + 1000 });
    const api = fakeApi({ Me: ME });
    const client = createApolloClient({ getAccessToken: async () => 'tok', getParentToken: session.getToken, fetch: api.fetch });
    const { ME: query } = await import('../src/queries.ts');
    await client.query({ query });
    expect(api.calls[0]!.authorization).toBe('Bearer tok');
  });
});

describe('the PIN screen at /settings', () => {
  it('asks for the PIN, and shows nothing of the settings until it is right', async () => {
    renderSettings({});
    expect(screen.getByRole('heading', { name: 'Parents only' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
    expect(pinBox().type).toBe('password');
  });

  it('unlocks with the right PIN, shows the settings, and sends the PIN as typed', async () => {
    const { api, session } = renderSettings({ UnlockParent: unlockReply('parent-1') });
    const user = userEvent.setup();
    await enterPin(user, '1234');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(api.variables[0]).toEqual({ pin: '1234' });
    expect(session.getToken()).toBe('parent-1');
    expect(screen.queryByLabelText('Parent PIN')).toBeNull();
  });

  it('stops taking digits after the eighth', async () => {
    renderSettings({});
    await userEvent.setup().type(pinBox(), '123456789');
    expect(pinBox().value).toBe('12345678');
  });

  it.each(['', '123', 'abcd', '12 34'])('does not send %j as a PIN', async (text) => {
    const { api } = renderSettings({});
    const user = userEvent.setup();
    if (text) await user.type(pinBox(), text);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The PIN is 4 to 8 digits');
    expect(api.calls).toEqual([]);
  });

  it('says how many tries are left after a wrong PIN, and empties the box', async () => {
    const { session } = renderSettings({
      UnlockParent: [
        failure('PIN_INCORRECT', 'Incorrect PIN', { attemptsRemaining: 4 }),
        failure('PIN_INCORRECT', 'Incorrect PIN', { attemptsRemaining: 1 }),
      ],
    });
    const user = userEvent.setup();
    await enterPin(user, '0000');
    expect((await screen.findByRole('alert')).textContent).toBe('Incorrect PIN. 4 tries left');
    expect(pinBox().value).toBe('');
    await enterPin(user, '0001');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Incorrect PIN. 1 try left'));
    expect(session.getToken()).toBeUndefined();
  });

  it('says when the PIN is locked out and when to try again', async () => {
    renderSettings({
      UnlockParent: failure('PIN_LOCKED', 'Too many wrong PINs. Try again later.', {
        retryAt: new Date(2026, 10, 10, 15, 45).toISOString(),
      }),
    });
    const user = userEvent.setup();
    await enterPin(user, '1234');
    const text = (await screen.findByRole('alert')).textContent!;
    expect(text).toMatch(/^Too many wrong PINs\. Try again at .*3:45.*PM\.$/);
  });

  it('says to try again later when a lockout has no time', async () => {
    renderSettings({ UnlockParent: failure('PIN_LOCKED', 'locked') });
    const user = userEvent.setup();
    await enterPin(user, '1234');
    expect((await screen.findByRole('alert')).textContent).toBe('Too many wrong PINs. Try again later.');
  });

  it('shows any other failure as a fault and stays locked', async () => {
    const { session } = renderSettings({ UnlockParent: failure('INTERNAL_SERVER_ERROR', 'boom') });
    const user = userEvent.setup();
    await enterPin(user, '1234');
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong: boom');
    expect(session.getToken()).toBeUndefined();
  });

  it('locks again on the Lock button, and asks for the PIN once more', async () => {
    const { session } = renderSettings({ UnlockParent: unlockReply() });
    const user = userEvent.setup();
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    await user.click(screen.getByRole('button', { name: 'Lock' }));
    expect(await screen.findByRole('heading', { name: 'Parents only' })).toBeTruthy();
    expect(session.getToken()).toBeUndefined();
  });

});

describe('keeping the unlock short', () => {
  it('locks when the token runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { session } = renderSettings({ UnlockParent: unlockReply('p', new Date(Date.now() + 60_000).toISOString()) });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    act(() => void vi.advanceTimersByTime(59_000));
    expect(session.getToken()).toBe('p');
    act(() => void vi.advanceTimersByTime(2_000));
    await screen.findByRole('heading', { name: 'Parents only' });
    expect(session.getToken()).toBeUndefined();
  });

  it('locks when the tab is hidden', async () => {
    const { session } = renderSettings({ UnlockParent: unlockReply() });
    const user = userEvent.setup();
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await screen.findByRole('heading', { name: 'Parents only' });
    expect(session.getToken()).toBeUndefined();
    state.mockRestore();
  });

  it('stays unlocked when the tab is shown again', async () => {
    const { session } = renderSettings({ UnlockParent: unlockReply() });
    const user = userEvent.setup();
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(session.getToken()).toBe('parent-1');
    state.mockRestore();
  });

  it('renews the token on activity once it is half a minute old, and uses the new one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, session } = renderSettings({
      UnlockParent: unlockReply('first'),
      RenewParentUnlock: renewReply('second'),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    // Too soon: no renewal.
    await user.click(document.body);
    expect(parentCalls(api)).toEqual(['UnlockParent']);
    act(() => void vi.advanceTimersByTime(31_000));
    await user.click(document.body);
    await waitFor(() => expect(session.getToken()).toBe('second'));
    expect(parentCalls(api)).toEqual(['UnlockParent', 'RenewParentUnlock']);
  });

  it('renews once for a burst of activity, not once per click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, session } = renderSettings({
      UnlockParent: unlockReply('first'),
      RenewParentUnlock: renewReply('second'),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    act(() => void vi.advanceTimersByTime(31_000));
    await user.click(document.body);
    await user.click(document.body);
    await user.click(document.body);
    await waitFor(() => expect(session.getToken()).toBe('second'));
    expect(api.calls.filter((c) => c.operationName === 'RenewParentUnlock')).toHaveLength(1);
  });

  it('does not ask again while a renewal is still on its way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (value: unknown) => void = () => {};
    const held = new Promise((resolve) => (release = resolve));
    const { api, session } = renderSettings({ UnlockParent: unlockReply('first'), RenewParentUnlock: () => held });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    act(() => void vi.advanceTimersByTime(31_000));
    await user.click(document.body);
    await user.click(document.body);
    await user.click(document.body);
    expect(api.calls.filter((c) => c.operationName === 'RenewParentUnlock')).toHaveLength(1);
    release(renewReply('second'));
    await waitFor(() => expect(session.getToken()).toBe('second'));
  });

  it('locks when a renewal is refused, because the token is spent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { session } = renderSettings({
      UnlockParent: unlockReply('first'),
      RenewParentUnlock: failure('FORBIDDEN', 'Not authorized'),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    act(() => void vi.advanceTimersByTime(31_000));
    await user.click(document.body);
    await screen.findByRole('heading', { name: 'Parents only' });
    expect(session.getToken()).toBeUndefined();
  });

  it('stays locked when the lock comes while a renewal is still out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (value: unknown) => void = () => {};
    const held = new Promise((resolve) => (release = resolve));
    const { session } = renderSettings({ UnlockParent: unlockReply('first'), RenewParentUnlock: () => held });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await enterPin(user, '1234');
    await screen.findByRole('heading', { name: 'Settings' });
    act(() => void vi.advanceTimersByTime(31_000));
    await user.click(document.body);
    await user.click(screen.getByRole('button', { name: 'Lock' }));
    await screen.findByRole('heading', { name: 'Parents only' });
    release(renewReply('late'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(session.getToken()).toBeUndefined();
  });
});

describe('getting to the screen', () => {
  it('links to /settings from the profile picker', async () => {
    const api = fakeApi({
      Me: ME,
      Family: { data: { family: { __typename: 'Family', name: 'The Gnls', profiles: [] } } },
    });
    const session = createParentSession();
    const client = createApolloClient({ getAccessToken: async () => 'tok', getParentToken: session.getToken, fetch: api.fetch });
    const router = createMemoryRouter(routes[0]!.children!, { initialEntries: ['/'] });
    render(
      <ApolloProvider client={client}>
        <ParentSessionProvider session={session}>
          <RouterProvider router={router} />
        </ParentSessionProvider>
      </ApolloProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Parent settings' }));
    expect(await screen.findByRole('heading', { name: 'Parents only' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to who’s reading' }).getAttribute('href')).toBe('/');
  });
});
