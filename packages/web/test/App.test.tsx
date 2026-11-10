import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logoutUrl } from '../src/config.ts';
import { routes } from '../src/routes.tsx';

const { useAuth } = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('react-oidc-context', () => ({ useAuth }));
// The page behind the gate is Home's business; here it is only a marker.
vi.mock('../src/Home.tsx', () => ({ default: () => <p>home page</p> }));

const removeUser = vi.fn();
const assign = vi.fn();

const renderApp = () => render(<RouterProvider router={createMemoryRouter(routes)} />);

beforeEach(() => {
  removeUser.mockReset().mockResolvedValue(undefined);
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, origin: 'https://books.gnlfamily.com', assign });
});

describe('App', () => {
  it('shows the page and a sign-out button to a signed-in user', () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, removeUser });
    renderApp();
    expect(screen.getByText('home page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('shows no page and no sign-out button to a signed-out user', () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, removeUser, signinRedirect: vi.fn() });
    renderApp();
    expect(screen.queryByText('home page')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('signs out of the app first, then of the Hosted UI', async () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, removeUser });
    const order: string[] = [];
    // Finishes after a delay, so only code that waits for it records it first.
    removeUser.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('removeUser');
    });
    assign.mockImplementation(() => void order.push('assign'));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(logoutUrl('https://books.gnlfamily.com')));
    expect(order).toEqual(['removeUser', 'assign']);
  });
});
