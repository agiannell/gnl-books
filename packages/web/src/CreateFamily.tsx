import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useApolloClient, useMutation } from '@apollo/client/react';
import { Button, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useState, type FormEvent } from 'react';
import { CREATE_FAMILY, ME } from './queries.ts';
import { Alert, Field } from './ui.tsx';

// The server enforces all of these too; checking here only saves a round trip.
// The inputs' maxLength stops anything longer being typed, so only the lower
// bounds and the PIN's digits need checking. The PIN pattern is the one in
// packages/core/src/pin.ts.
const MAX_NAME = 60;
const MAX_PIN = 8;
const PIN = /^\d{4,8}$/;

/** What is wrong with the form, or undefined when it is fine to send. */
function problem(familyName: string, parentName: string, pin: string, pinAgain: string): string | undefined {
  if (!familyName.trim()) return `Family name must be 1 to ${MAX_NAME} characters.`;
  if (!parentName.trim()) return `Your name must be 1 to ${MAX_NAME} characters.`;
  if (!PIN.test(pin)) return 'The PIN must be 4 to 8 digits.';
  if (pin !== pinAgain) return 'The two PINs do not match.';
  return undefined;
}

/** First run: a signed-in adult with no family names it, and picks the parent PIN. */
export default function CreateFamily() {
  const client = useApolloClient();
  const [createFamily, { loading, error }] = useMutation(CREATE_FAMILY);
  const [familyName, setFamilyName] = useState('');
  const [parentName, setParentName] = useState('');
  const [pin, setPin] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [invalid, setInvalid] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = problem(familyName, parentName, pin, pinAgain);
    setInvalid(found);
    if (found) return;
    try {
      await createFamily({
        variables: { familyName: familyName.trim(), parentName: parentName.trim(), pin },
        // Home reads the family from `me`; wait for it so the form never flashes back.
        refetchQueries: [ME],
        awaitRefetchQueries: true,
      });
    } catch (caught) {
      // The reason is in `error` below. If another tab already made the family, just look again.
      if (CombinedGraphQLErrors.is(caught) && caught.errors.some((e) => e.extensions?.code === 'CONFLICT')) {
        await client.refetchQueries({ include: [ME] });
      }
    }
  };

  return (
    <Card size="4" className="centered-card">
      <form onSubmit={(event) => void submit(event)}>
        <Flex direction="column" gap="4">
          <Heading as="h1" size="7">
            Set up your family
          </Heading>
          <Text color="gray">
            The parent PIN protects parent-only actions, like deleting a profile. Choose 4 to 8 digits and share it only
            with the other adults.
          </Text>
          <Field label="Family name">
            <TextField.Root
              size="3"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              maxLength={MAX_NAME}
              autoComplete="off"
            />
          </Field>
          <Field label="Your name">
            <TextField.Root
              size="3"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              maxLength={MAX_NAME}
              autoComplete="off"
            />
          </Field>
          <Field label="Parent PIN">
            <TextField.Root
              size="3"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={MAX_PIN}
              autoComplete="off"
            />
          </Field>
          <Field label="Parent PIN again">
            <TextField.Root
              size="3"
              type="password"
              inputMode="numeric"
              value={pinAgain}
              onChange={(e) => setPinAgain(e.target.value)}
              maxLength={MAX_PIN}
              autoComplete="off"
            />
          </Field>
          {(invalid ?? error) && <Alert>{invalid ?? error?.message}</Alert>}
          <Button type="submit" size="3" disabled={loading}>
            {loading ? 'Creating…' : 'Create family'}
          </Button>
        </Flex>
      </form>
    </Card>
  );
}
