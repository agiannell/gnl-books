import { Button, Flex, Text } from '@radix-ui/themes';
import { useState } from 'react';
import { useParentSession } from './ParentSessionProvider.tsx';
import PinForm from './PinForm.tsx';
import { REMOVE_FROM_SHELF } from './queries.ts';
import { Alert, Panel } from './ui.tsx';
import { useEdit } from './useEdit.ts';

/**
 * Takes a book off a reader's shelf, which is parent-only because it deletes their rating, review and
 * reading history. A child who finds it sees the PIN box; the API checks the unlock as well, so this is
 * the polite half of the lock. Asks once more before it deletes, and calls `onRemoved` when it has.
 */
export default function RemoveFromShelf({
  entryId,
  title,
  readerName,
  onRemoved,
}: {
  entryId: string;
  title: string;
  readerName: string;
  onRemoved: () => void;
}) {
  const { unlocked } = useParentSession();
  const { edit, busy, error } = useEdit();
  const [confirming, setConfirming] = useState(false);

  // If the unlock runs out, the question goes with it: coming back to the page after unlocking again must not
  // find a half-answered "are you sure" waiting. (State adjusted while rendering, as React advises, rather than in an effect.)
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (unlocked !== wasUnlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) setConfirming(false);
  }

  const remove = async () => {
    if (await edit({ mutation: REMOVE_FROM_SHELF, variables: { shelfEntryId: entryId } })) onRemoved();
  };

  return (
    <Panel id="remove-heading" title="Remove from shelf">
      {!unlocked ? (
        <>
          <Text color="gray">Taking a book off a shelf needs a parent. Enter the parent PIN to go on.</Text>
          <PinForm />
        </>
      ) : confirming ? (
        <Flex direction="column" gap="3" align="start">
          <Text color="red">
            Remove “{title}” from {readerName}’s shelf? Its rating, review and reading history go too. This cannot be undone.
          </Text>
          <Flex gap="3" wrap="wrap">
            <Button type="button" color="red" size="3" disabled={busy} onClick={() => void remove()}>
              Yes, remove it
            </Button>
            <Button type="button" variant="soft" color="gray" size="3" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </Flex>
        </Flex>
      ) : (
        <Flex direction="column" gap="3" align="start">
          <Text color="gray">Take this book off {readerName}’s shelf, with its rating, review and reading history.</Text>
          <Button type="button" color="red" variant="soft" size="3" onClick={() => setConfirming(true)}>
            Remove from shelf
          </Button>
        </Flex>
      )}
      {error && <Alert>Something went wrong: {error}</Alert>}
    </Panel>
  );
}
