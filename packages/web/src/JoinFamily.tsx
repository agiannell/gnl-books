import { useApolloClient, useMutation } from '@apollo/client/react';
import { Button, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useState, type FormEvent } from 'react';
import { ME, REQUEST_TO_JOIN } from './queries.ts';
import { Alert, Field } from './ui.tsx';

// The server checks the address again. This only catches a typo before the request is made.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Asking to join a family instead of making one: the person enters the email of a parent in it, and
 * that parent approves them in their settings. The API answers the same whether or not the email
 * belongs to a family (so nobody can use this to find out), and so does this page.
 */
export default function JoinFamily({ onCreateInstead }: { onCreateInstead: () => void }) {
  const client = useApolloClient();
  const [requestToJoin, { loading, error }] = useMutation(REQUEST_TO_JOIN);
  const [parentEmail, setParentEmail] = useState('');
  const [invalid, setInvalid] = useState<string>();
  const [sent, setSent] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = parentEmail.trim();
    const found = EMAIL.test(trimmed) ? undefined : 'Enter the email address of a parent in that family.';
    setInvalid(found);
    if (found) return;
    try {
      await requestToJoin({ variables: { parentEmail: trimmed } });
      setSent(true);
    } catch {
      // The reason is in `error` below.
    }
  };

  // Home reads the family from `me`: once a parent has approved, it shows the family instead of this page.
  const checkAgain = async () => {
    setChecking(true);
    try {
      await client.refetchQueries({ include: [ME] });
    } finally {
      setChecking(false);
    }
  };

  if (sent) {
    return (
      <Card size="4" className="centered-card">
        <Flex direction="column" gap="4" align="start">
          <Heading as="h1" size="7">
            Request sent
          </Heading>
          <Text>
            If <strong>{parentEmail.trim()}</strong> belongs to a family, a parent can now approve you in{' '}
            <em>Parent settings</em>. Ask them to look there. The request lasts 7 days.
          </Text>
          <Text color="gray">Once they have approved you, check again to see the family.</Text>
          <Flex gap="3" wrap="wrap">
            <Button type="button" size="3" disabled={checking} onClick={() => void checkAgain()}>
              {checking ? 'Checking…' : 'Check again'}
            </Button>
            <Button type="button" size="3" variant="soft" onClick={() => setSent(false)}>
              Use a different email
            </Button>
          </Flex>
          <Button type="button" variant="ghost" onClick={onCreateInstead}>
            Set up my own family instead
          </Button>
        </Flex>
      </Card>
    );
  }

  return (
    <Card size="4" className="centered-card">
      {/* noValidate: the browser's own email check would stop the submit with its own wording, and this page has its own. */}
      <form noValidate onSubmit={(event) => void submit(event)}>
        <Flex direction="column" gap="4">
          <Heading as="h1" size="7">
            Join a family
          </Heading>
          <Text color="gray">
            Enter the email address of a parent in the family you want to join. They will see your request in their
            settings and can approve it with their PIN.
          </Text>
          <Field label="Parent’s email">
            <TextField.Root
              size="3"
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              maxLength={254}
              autoComplete="off"
            />
          </Field>
          {(invalid ?? error) && <Alert>{invalid ?? error?.message}</Alert>}
          <Button type="submit" size="3" disabled={loading}>
            {loading ? 'Sending…' : 'Ask to join'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCreateInstead}>
            Set up my own family instead
          </Button>
        </Flex>
      </form>
    </Card>
  );
}
