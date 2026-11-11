import { useQuery } from '@apollo/client/react';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { useState } from 'react';
import CreateFamily from './CreateFamily.tsx';
import JoinFamily from './JoinFamily.tsx';
import { JOIN_REQUEST_DENIED } from './queries.ts';
import { Loading } from './ui.tsx';

/**
 * A signed-in user with no family: they set one up, or ask a parent of an existing one to let them
 * in. Setting one up comes first, because that is what almost everyone signing in here wants. If a
 * parent turned their request down, they are told so first, and offered the same two choices.
 */
export default function NoFamily() {
  const [joining, setJoining] = useState(false);
  // Set once they have read the notice; cleared when they ask again, so a second denial shows too.
  const [seen, setSeen] = useState(false);
  // A failed lookup is treated as "not denied": it must never stand between someone and setting up a family.
  const { data, loading } = useQuery<{ joinRequestDenied: boolean }>(JOIN_REQUEST_DENIED, {
    fetchPolicy: 'cache-and-network',
  });

  if (loading && !data) return <Loading />;

  if (data?.joinRequestDenied && !seen) {
    return (
      <Card size="4" className="centered-card">
        <Flex direction="column" gap="4" align="start">
          <Heading as="h1" size="7">
            Request declined
          </Heading>
          <Text>A parent of that family declined your request to join.</Text>
          <Text color="gray">You can ask a different parent, or set up a family of your own.</Text>
          <Flex gap="3" wrap="wrap">
            <Button
              type="button"
              size="3"
              onClick={() => {
                setSeen(true);
                setJoining(true);
              }}
            >
              Ask a different parent
            </Button>
            <Button
              type="button"
              size="3"
              variant="soft"
              onClick={() => {
                setSeen(true);
                setJoining(false);
              }}
            >
              Set up my own family
            </Button>
          </Flex>
        </Flex>
      </Card>
    );
  }

  if (joining) return <JoinFamily onCreateInstead={() => setJoining(false)} onAsked={() => setSeen(false)} />;
  return (
    <Flex direction="column" gap="4" align="center">
      <CreateFamily />
      <Button type="button" variant="ghost" onClick={() => setJoining(true)}>
        Join someone else’s family instead
      </Button>
    </Flex>
  );
}
