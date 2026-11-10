import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { useLocation } from 'react-router';

/** Shows its children only to a signed-in user; everyone else gets a way to sign in. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isLoading) return <p>Signing in…</p>;
  if (auth.isAuthenticated) return children;

  // Remember where the person was going; the sign-in callback returns them there.
  const signIn = () => auth.signinRedirect({ state: { returnTo: location.pathname + location.search } });
  return (
    <>
      {auth.error && <p role="alert">Sign-in failed: {auth.error.message}</p>}
      <p>Sign in to see your family’s library.</p>
      <button type="button" onClick={() => void signIn()}>
        Sign in
      </button>
    </>
  );
}
