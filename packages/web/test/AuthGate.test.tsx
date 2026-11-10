import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthGate from '../src/AuthGate.tsx';

const { useAuth } = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('react-oidc-context', () => ({ useAuth }));

const signinRedirect = vi.fn();
const renderGate = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthGate>
        <p>the library</p>
      </AuthGate>
    </MemoryRouter>,
  );

beforeEach(() => {
  signinRedirect.mockReset().mockResolvedValue(undefined);
});

describe('AuthGate', () => {
  it('shows its children to a signed-in user', () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, signinRedirect });
    renderGate();
    expect(screen.getByText('the library')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('shows neither the children nor a button while the session is loading', () => {
    useAuth.mockReturnValue({ isLoading: true, isAuthenticated: false, signinRedirect });
    renderGate();
    expect(screen.getByText('Signing in…')).toBeTruthy();
    expect(screen.queryByText('the library')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('offers to sign in when signed out, and hides the children', () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, signinRedirect });
    renderGate();
    expect(screen.queryByText('the library')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('remembers the page being visited, so the callback can return there', () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, signinRedirect });
    renderGate('/p/abc?tab=read');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/p/abc?tab=read' } });
  });

  it('says why a sign-in failed, and lets the person try again', () => {
    useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      error: new Error('invalid_grant'),
      signinRedirect,
    });
    renderGate();
    expect(screen.getByRole('alert').textContent).toContain('invalid_grant');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('does not show the children to a signed-out user even if there is an error', () => {
    useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false, error: new Error('x'), signinRedirect });
    renderGate();
    expect(screen.queryByText('the library')).toBeNull();
  });
});
