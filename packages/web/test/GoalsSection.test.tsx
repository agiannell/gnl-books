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

const renewed = () => ({
  data: { renewParentUnlock: { __typename: 'ParentUnlock', token: 'parent', expiresAt: new Date(Date.now() + 600_000).toISOString() } },
});

const reader = (id: string, name: string) => ({ __typename: 'Profile', id, name, emoji: null, color: null, isParent: false });
const PAT = reader('p-1', 'Pat');
const SAM = reader('p-2', 'Sam');
const readers = { data: { family: { __typename: 'Family', id: 'f-1', name: 'The Gnls', profiles: [PAT, SAM] } } };

const goal = (year: number, target: number, booksRead = 0) => ({ __typename: 'ReadingGoal', year, target, booksRead });
const goals = (pat: unknown, sam: unknown = null) => ({
  data: {
    family: {
      __typename: 'Family',
      id: 'f-1',
      profiles: [
        { __typename: 'Profile', id: 'p-1', name: 'Pat', goal: pat },
        { __typename: 'Profile', id: 'p-2', name: 'Sam', goal: sam },
      ],
    },
  },
});
const failure = (message: string) => ({ errors: [{ message }] });

const renderSettings = (handlers: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi({
    SettingsProfiles: readers,
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

const section = async () => within(await screen.findByRole('region', { name: 'Reading goals' }));
// A reader's name is bold and the rest is plain text, so match the whole list item.
const row = (text: RegExp) => (_content: string, element: Element | null) =>
  element?.tagName === 'LI' && text.test(element.textContent ?? '');
// The requests this section makes, in order, with their variables.
const goalCalls = (api: ReturnType<typeof fakeApi>) =>
  api.calls.flatMap((c, i) => (/Goal/.test(c.operationName) ? [{ name: c.operationName, variables: api.variables[i] }] : []));
const thisYear = new Date().getFullYear();

afterEach(() => {
  vi.useRealTimers();
});

describe('the goals section of the settings', () => {
  it('shows each reader’s goal for this year, and "no goal" for a reader without one', async () => {
    const api = renderSettings({ SettingsGoals: goals(goal(thisYear, 12, 3)) });
    const s = await section();
    expect(await s.findByText(row(/Pat:/))).toBeTruthy();
    const items = s.getAllByRole('listitem');
    expect(items[0]!.textContent).toContain(`Pat: 3 of 12 books read`);
    expect(items[1]!.textContent).toContain('Sam: no goal');
    expect(goalCalls(api)).toEqual([{ name: 'SettingsGoals', variables: { year: thisYear } }]);
  });

  it('says "book" for a target of one', async () => {
    renderSettings({ SettingsGoals: goals(goal(thisYear, 1, 0)) });
    expect(await (await section()).findByText(row(/Pat: 0 of 1 book read/))).toBeTruthy();
  });

  it('asks once for the readers and once for the goals on opening, with no repeats', async () => {
    const api = renderSettings({ SettingsGoals: goals(null) });
    await (await section()).findByText(row(/Sam: no goal/));
    await screen.findByText('Delete Pat');
    // Both sections read the same family; each asking once means Apollo merged them rather than overwriting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls.filter((c) => c.operationName === 'SettingsProfiles')).toHaveLength(1);
    expect(api.calls.filter((c) => c.operationName === 'SettingsGoals')).toHaveLength(1);
  });

  describe('the year', () => {
    it('moves a year at a time and asks the API for that year’s goals', async () => {
      const api = renderSettings({
        SettingsGoals: [goals(goal(thisYear, 12)), goals(goal(thisYear - 1, 20, 20)), goals(null)],
      });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: 0 of 12 books read/));
      await user.click(s.getByRole('button', { name: 'Earlier year' }));
      expect(await s.findByText(row(/Pat: 20 of 20 books read/))).toBeTruthy();
      expect(s.getByText(String(thisYear - 1), { selector: 'strong' })).toBeTruthy();
      await user.click(s.getByRole('button', { name: 'Later year' }));
      await waitFor(() => expect(s.getByText(String(thisYear), { selector: 'strong' })).toBeTruthy());
      // Back on this year it asks again, rather than trusting what it saw earlier.
      await waitFor(() => expect(goalCalls(api).map((c) => c.variables)).toEqual([{ year: thisYear }, { year: thisYear - 1 }, { year: thisYear }]));
      expect(await s.findByText(row(/Pat: no goal/))).toBeTruthy();
    });

    it('stops at the first and last year the API accepts', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2000-06-01T12:00:00Z'));
      renderSettings({ SettingsGoals: goals(null) });
      const s = await section();
      expect((s.getByRole('button', { name: 'Earlier year' }) as HTMLButtonElement).disabled).toBe(true);
      expect((s.getByRole('button', { name: 'Later year' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('stops at the last year', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2100-06-01T12:00:00Z'));
      renderSettings({ SettingsGoals: goals(null) });
      const s = await section();
      expect((s.getByRole('button', { name: 'Later year' }) as HTMLButtonElement).disabled).toBe(true);
      expect((s.getByRole('button', { name: 'Earlier year' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('setting a goal', () => {
    it('sends the reader, the year and the target, then shows the new goal', async () => {
      const api = renderSettings({
        SettingsGoals: [goals(null), goals(goal(thisYear, 24, 2))],
        SetGoal: { data: { setGoal: goal(thisYear, 24, 2) } },
      });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: no goal/));
      await user.type(s.getByLabelText(`Books to read in ${thisYear} for Pat`), ' 24 ');
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      expect(await s.findByText(row(/Pat: 2 of 24 books read/))).toBeTruthy();
      expect(goalCalls(api)[1]).toEqual({ name: 'SetGoal', variables: { profileId: 'p-1', year: thisYear, target: 24 } });
      expect((s.getByLabelText(`Books to read in ${thisYear} for Pat`) as HTMLInputElement).value).toBe('24');
    });

    it('sets the goal for the reader whose button was pressed', async () => {
      const api = renderSettings({
        SettingsGoals: [goals(null, null), goals(null, goal(thisYear, 7))],
        SetGoal: { data: { setGoal: goal(thisYear, 7) } },
      });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Sam: no goal/));
      await user.type(s.getByLabelText(`Books to read in ${thisYear} for Sam`), '7');
      await user.click(s.getByRole('button', { name: 'Set goal for Sam' }));
      await s.findByText(row(/Sam: 0 of 7 books read/));
      expect(goalCalls(api)[1]).toEqual({ name: 'SetGoal', variables: { profileId: 'p-2', year: thisYear, target: 7 } });
      expect(s.getByText(row(/Pat: no goal/))).toBeTruthy();
    });

    it('shows only the API’s reason when a corrected goal is refused after a "whole number" message', async () => {
      renderSettings({ SettingsGoals: goals(null), SetGoal: failure('Profile not found') });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: no goal/));
      const box = s.getByLabelText(`Books to read in ${thisYear} for Pat`);
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      await s.findByText('The goal must be a whole number from 1 to 1000');
      await user.type(box, '12');
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      await s.findByText(/Profile not found/);
      expect(s.queryByText('The goal must be a whole number from 1 to 1000')).toBeNull();
    });

    it('starts each box with the reader’s saved target, and keeps the boxes apart', async () => {
      renderSettings({ SettingsGoals: goals(goal(thisYear, 12), goal(thisYear, 5)) });
      const user = userEvent.setup();
      const s = await section();
      const pat = (await s.findByLabelText(`Books to read in ${thisYear} for Pat`)) as HTMLInputElement;
      const sam = s.getByLabelText(`Books to read in ${thisYear} for Sam`) as HTMLInputElement;
      expect([pat.value, sam.value]).toEqual(['12', '5']);
      await user.type(pat, '0');
      expect([pat.value, sam.value]).toEqual(['120', '5']);
    });

    it.each(['', 'abc', '0', '1001', '-3', '1.5', '12 3'])('does not send %j as a goal', async (text) => {
      const api = renderSettings({ SettingsGoals: goals(null) });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: no goal/));
      if (text) await user.type(s.getByLabelText(`Books to read in ${thisYear} for Pat`), text);
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      expect((await s.findByRole('alert')).textContent).toBe('The goal must be a whole number from 1 to 1000');
      expect(goalCalls(api).map((c) => c.name)).toEqual(['SettingsGoals']);
    });

    it('accepts the largest goal the API allows', async () => {
      const api = renderSettings({ SettingsGoals: [goals(null), goals(goal(thisYear, 1000))], SetGoal: { data: { setGoal: goal(thisYear, 1000) } } });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: no goal/));
      await user.type(s.getByLabelText(`Books to read in ${thisYear} for Pat`), '1000');
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      await s.findByText(row(/Pat: 0 of 1000 books read/));
      expect(goalCalls(api)[1]!.variables).toMatchObject({ target: 1000 });
    });

    it('shows the API’s reason and keeps what was typed', async () => {
      renderSettings({ SettingsGoals: goals(null), SetGoal: failure('Profile not found') });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: no goal/));
      await user.type(s.getByLabelText(`Books to read in ${thisYear} for Pat`), '12');
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      expect((await s.findByText(/Profile not found/)).textContent).toContain('Something went wrong');
      expect((s.getByLabelText(`Books to read in ${thisYear} for Pat`) as HTMLInputElement).value).toBe('12');
    });

    it('clears a "whole number" message once a goal is accepted', async () => {
      renderSettings({ SettingsGoals: [goals(null), goals(goal(thisYear, 12))], SetGoal: { data: { setGoal: goal(thisYear, 12) } } });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: no goal/));
      const box = s.getByLabelText(`Books to read in ${thisYear} for Pat`);
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      await s.findByRole('alert');
      await user.type(box, '12');
      await user.click(s.getByRole('button', { name: 'Set goal for Pat' }));
      await waitFor(() => expect(s.queryByRole('alert')).toBeNull());
    });
  });

  describe('removing a goal', () => {
    it('is offered only to a reader who has one', async () => {
      renderSettings({ SettingsGoals: goals(goal(thisYear, 12)) });
      const s = await section();
      await s.findByText(row(/Pat: 0 of 12/));
      expect(s.getByRole('button', { name: 'Remove goal for Pat' })).toBeTruthy();
      expect(s.queryByRole('button', { name: 'Remove goal for Sam' })).toBeNull();
    });

    it('removes the goal for that reader and year, shows "no goal" and empties the box', async () => {
      const api = renderSettings({
        SettingsGoals: [goals(goal(thisYear, 12)), goals(null)],
        RemoveGoal: { data: { removeGoal: true } },
      });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: 0 of 12/));
      await user.click(s.getByRole('button', { name: 'Remove goal for Pat' }));
      expect(await s.findByText(row(/Pat: no goal/))).toBeTruthy();
      expect(goalCalls(api)[1]).toEqual({ name: 'RemoveGoal', variables: { profileId: 'p-1', year: thisYear } });
      expect((s.getByLabelText(`Books to read in ${thisYear} for Pat`) as HTMLInputElement).value).toBe('');
      expect(s.queryByRole('button', { name: 'Remove goal for Pat' })).toBeNull();
    });

    it('shows the API’s reason when the goal cannot be removed, and keeps the goal', async () => {
      renderSettings({ SettingsGoals: goals(goal(thisYear, 12)), RemoveGoal: failure('Goal not found') });
      const user = userEvent.setup();
      const s = await section();
      await s.findByText(row(/Pat: 0 of 12/));
      await user.click(s.getByRole('button', { name: 'Remove goal for Pat' }));
      expect((await s.findByRole('alert')).textContent).toContain('Goal not found');
      expect(s.getByText(row(/Pat: 0 of 12/))).toBeTruthy();
    });
  });

  it('shows the API’s message when the goals cannot be loaded', async () => {
    renderSettings({ SettingsGoals: failure('Not authorized') });
    expect((await (await section()).findByRole('alert')).textContent).toContain('Not authorized');
  });
});
