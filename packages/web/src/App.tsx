import { ReaderIcon } from '@radix-ui/react-icons';
import { Button, Container, Flex } from '@radix-ui/themes';
import { useAuth } from 'react-oidc-context';
import { Link, Outlet } from 'react-router';
import AuthGate from './AuthGate.tsx';
import { logoutUrl } from './config.ts';
import { AppTheme } from './theme.tsx';

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
    <AppTheme>
      <header className="app-header">
        <Container size="4" px="4">
          <Flex align="center" justify="between" py="3" gap="3">
            <Link to="/" className="app-brand">
              <ReaderIcon width={24} height={24} aria-hidden="true" />
              <span>Family Library</span>
            </Link>
            {auth.isAuthenticated && (
              <Button type="button" variant="soft" color="gray" onClick={() => void signOut()}>
                Sign out
              </Button>
            )}
          </Flex>
        </Container>
      </header>
      <main>
        <Container size="4" px="4" py="5">
          <AuthGate>
            <Outlet />
          </AuthGate>
        </Container>
      </main>
    </AppTheme>
  );
}
