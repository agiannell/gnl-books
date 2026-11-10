import { useAuth } from 'react-oidc-context';
import { Outlet } from 'react-router';
import AuthGate from './AuthGate.tsx';
import { logoutUrl } from './config.ts';

/** The frame every page sits in: a header, and the page behind the sign-in gate. */
export default function App() {
  const auth = useAuth();

  const signOut = async () => {
    // Drop the local session, then end the Hosted UI one, or the next
    // "Sign in" would sign straight back in without asking.
    await auth.removeUser();
    window.location.assign(logoutUrl(window.location.origin));
  };

  return (
    <>
      <header>
        <strong>Family Library</strong>
        {auth.isAuthenticated && (
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </header>
      <main>
        <AuthGate>
          <Outlet />
        </AuthGate>
      </main>
    </>
  );
}
