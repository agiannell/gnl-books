import { type FormEvent, type ReactNode, useState } from 'react';
import { useParentSession } from './ParentSessionProvider.tsx';

// The PIN is 4 to 8 digits (packages/core/src/pin.ts). The API does not count a malformed
// PIN as a wrong guess, but checking here saves the round trip.
const PIN_PATTERN = /^\d{4,8}$/;

/** "Try again at 3:45 PM", or just "Try again later" when the API gave no time. */
const retryText = (retryAt: Date | null) =>
  retryAt && !Number.isNaN(retryAt.getTime())
    ? `Try again at ${retryAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    : 'Try again later.';

/**
 * Shows its children only to an unlocked parent; everyone else gets the PIN form. The
 * lock is the only thing between a child with the tablet and the parent-only actions
 * (the API checks it too), so it asks again whenever the unlock runs out.
 */
export default function ParentGate({ children }: { children: ReactNode }) {
  const { unlocked, unlock, lock } = useParentSession();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (unlocked) {
    return (
      <>
        <p>
          <button type="button" onClick={lock}>
            Lock
          </button>
        </p>
        {children}
      </>
    );
  }

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
      <h1>Parents only</h1>
      <p>
        <label>
          Parent PIN{' '}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
        </label>
      </p>
      <button type="submit" disabled={busy}>
        Unlock
      </button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
