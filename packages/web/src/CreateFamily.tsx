import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useApolloClient, useMutation } from '@apollo/client/react';
import { useState, type FormEvent } from 'react';
import { CREATE_FAMILY, ME } from './queries.ts';

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
    <form onSubmit={(event) => void submit(event)}>
      <h1>Set up your family</h1>
      <p>
        The parent PIN protects parent-only actions, like deleting a profile. Choose 4 to 8 digits and share it only
        with the other adults.
      </p>
      <p>
        <label>
          Family name
          <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} maxLength={MAX_NAME} autoComplete="off" />
        </label>
      </p>
      <p>
        <label>
          Your name
          <input value={parentName} onChange={(e) => setParentName(e.target.value)} maxLength={MAX_NAME} autoComplete="off" />
        </label>
      </p>
      <p>
        <label>
          Parent PIN
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={MAX_PIN}
            autoComplete="off"
          />
        </label>
      </p>
      <p>
        <label>
          Parent PIN again
          <input
            type="password"
            inputMode="numeric"
            value={pinAgain}
            onChange={(e) => setPinAgain(e.target.value)}
            maxLength={MAX_PIN}
            autoComplete="off"
          />
        </label>
      </p>
      {(invalid ?? error) && <p role="alert">{invalid ?? error?.message}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create family'}
      </button>
    </form>
  );
}
