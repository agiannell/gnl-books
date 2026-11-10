import { Button, Flex, TextField } from '@radix-ui/themes';
import { type FormEvent, useState } from 'react';
import { useParentSession } from './ParentSessionProvider.tsx';
import { Alert, Field } from './ui.tsx';

// The PIN is 4 to 8 digits (packages/core/src/pin.ts). The API does not count a malformed
// PIN as a wrong guess, but checking here saves the round trip.
const PIN_PATTERN = /^\d{4,8}$/;

/** "Try again at 3:45 PM", or just "Try again later" when the API gave no time. */
const retryText = (retryAt: Date | null) =>
  retryAt && !Number.isNaN(retryAt.getTime())
    ? `Try again at ${retryAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    : 'Try again later.';

/**
 * The parent PIN box: asks the API, says how many tries are left or when a lockout ends, and empties
 * itself either way. A right PIN unlocks the app (see ParentSessionProvider), so whatever is waiting on
 * the unlock appears by itself.
 */
export default function PinForm() {
  const { unlock } = useParentSession();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!PIN_PATTERN.test(pin)) return setMessage('The PIN is 4 to 8 digits');
    setMessage(null);
    setBusy(true);
    const result = await unlock(pin);
    setBusy(false);
    // Wrong or not, the PIN does not stay on screen or in the box.
    setPin('');
    if (result.ok) return;
    if (result.reason === 'incorrect') {
      setMessage(
        result.attemptsRemaining === null
          ? 'Incorrect PIN'
          : `Incorrect PIN. ${result.attemptsRemaining} ${result.attemptsRemaining === 1 ? 'try' : 'tries'} left`,
      );
    } else if (result.reason === 'locked') {
      setMessage(`Too many wrong PINs. ${retryText(result.retryAt)}`);
    } else {
      setMessage(`Something went wrong: ${result.message}`);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Flex direction="column" gap="4" align="stretch">
        <Field label="Parent PIN">
          <TextField.Root
            size="3"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
        </Field>
        <Button type="submit" size="3" disabled={busy}>
          Unlock
        </Button>
        {message && <Alert>{message}</Alert>}
      </Flex>
    </form>
  );
}
