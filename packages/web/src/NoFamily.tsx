import { Button, Flex } from '@radix-ui/themes';
import { useState } from 'react';
import CreateFamily from './CreateFamily.tsx';
import JoinFamily from './JoinFamily.tsx';

/**
 * A signed-in user with no family: they set one up, or ask a parent of an existing one to let them
 * in. Setting one up comes first, because that is what almost everyone signing in here wants.
 */
export default function NoFamily() {
  const [joining, setJoining] = useState(false);
  if (joining) return <JoinFamily onCreateInstead={() => setJoining(false)} />;
  return (
    <Flex direction="column" gap="4" align="center">
      <CreateFamily />
      <Button type="button" variant="ghost" onClick={() => setJoining(true)}>
        Join someone else’s family instead
      </Button>
    </Flex>
  );
}
