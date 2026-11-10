import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../src/routes.tsx';

const { useAuth } = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('react-oidc-context', () => ({ useAuth }));
// The pages are tested on their own; here they are only markers for which one was chosen.
vi.mock('../src/Home.tsx', () => ({ default: () => <p>picker page</p> }));
vi.mock('../src/ProfilePage.tsx', () => ({ default: () => <p>profile page</p> }));

const renderAt = (path: string) => render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
const signedIn = () => useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, removeUser: vi.fn() });
const signedOut = () =>
  useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, removeUser: vi.fn(), signinRedirect: vi.fn() });

beforeEach(() => useAuth.mockReset());

describe('routes', () => {
  it('shows the picker at the start', () => {
    signedIn();
    renderAt('/');
    expect(screen.getByText('picker page')).toBeTruthy();
  });

  it('shows a profile’s page at /p/:profileId', () => {
    signedIn();
    renderAt('/p/abc');
    expect(screen.getByText('profile page')).toBeTruthy();
    expect(screen.queryByText('picker page')).toBeNull();
  });

  it.each(['/nope', '/p', '/p/abc/extra/deep', '/search/'])('shows the not-found page, in the frame, at %s', (path) => {
    signedIn();
    renderAt(path);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByText('Family Library')).toBeTruthy();
    expect(screen.queryByText('profile page')).toBeNull();
  });

  it.each(['/', '/p/abc', '/nope'])('shows nothing but the sign-in prompt to a signed-out visitor at %s', (path) => {
    signedOut();
    renderAt(path);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('picker page')).toBeNull();
    expect(screen.queryByText('profile page')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });
});
