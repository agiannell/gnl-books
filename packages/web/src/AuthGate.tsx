import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { useLocation } from 'react-router';
import { Alert, Loading } from './ui.tsx';

/** Shows its children only to a signed-in user; everyone else gets a way to sign in. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isLoading) return <Loading>Signing in…</Loading>;
  if (auth.isAuthenticated) return children;

  // Remember where the person was going; the sign-in callback returns them there.
  const signIn = () => auth.signinRedirect({ state: { returnTo: location.pathname + location.search } });
  return (
    <Card size="4" className="centered-card">
      <Flex direction="column" gap="4" align="start">
        <Heading as="h1" size="6">
          Welcome back
        </Heading>
        {auth.error && <Alert>Sign-in failed: {auth.error.message}</Alert>}
        <Text size="3">Sign in to see your family’s library.</Text>
        <Button type="button" size="3" onClick={() => void signIn()}>
          Sign in
        </Button>
      </Flex>
    </Card>
  );
}
