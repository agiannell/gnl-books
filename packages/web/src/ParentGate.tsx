import { LockClosedIcon, LockOpen1Icon } from '@radix-ui/react-icons';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useParentSession } from './ParentSessionProvider.tsx';
import PinForm from './PinForm.tsx';

/**
 * Shows its children only to an unlocked parent; everyone else gets the PIN form. The
 * lock is the only thing between a child with the tablet and the parent-only actions
 * (the API checks it too), so it asks again whenever the unlock runs out.
 */
export default function ParentGate({ children }: { children: ReactNode }) {
  const { unlocked, lock } = useParentSession();

  if (unlocked) {
    return (
      <Flex direction="column" gap="5">
        <Flex justify="end">
          <Button type="button" variant="soft" color="gray" onClick={lock}>
            <LockClosedIcon aria-hidden="true" />
            Lock
          </Button>
        </Flex>
        {children}
      </Flex>
    );
  }

  return (
    <Card size="4" className="centered-card">
      <Flex direction="column" gap="4" align="stretch">
        <Flex align="center" gap="3">
          <LockOpen1Icon width={28} height={28} color="var(--accent-9)" aria-hidden="true" />
          <Heading as="h1" size="6">
            Parents only
          </Heading>
        </Flex>
        <Text color="gray">Enter the parent PIN to change settings.</Text>
        <PinForm />
      </Flex>
    </Card>
  );
}
