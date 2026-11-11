import { useQuery } from '@apollo/client/react';
import { Button, Flex, Text } from '@radix-ui/themes';
import {
  APPROVE_JOIN_REQUEST,
  DENY_JOIN_REQUEST,
  SETTINGS_JOIN_REQUESTS,
  type SettingsJoinRequestsData,
} from './queries.ts';
import { Alert, Loading, Panel } from './ui.tsx';
import { useEdit } from './useEdit.ts';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * People who signed up and asked to join this family. Approving one makes them an adult of the
 * family, with the same access to every reader's books, so it says so.
 */
export default function JoinRequestsSection() {
  const { data, loading, error } = useQuery<SettingsJoinRequestsData>(SETTINGS_JOIN_REQUESTS, {
    fetchPolicy: 'cache-and-network',
  });
  const { edit, busy, error: editError } = useEdit();

  const answer = (mutation: typeof APPROVE_JOIN_REQUEST, requestId: string) =>
    void edit({ mutation, variables: { requestId }, refetchQueries: [SETTINGS_JOIN_REQUESTS] });

  const requests = data?.family.joinRequests ?? [];
  return (
    <Panel id="join-requests-heading" title="Join requests">
      <Text color="gray">
        Someone who signs up can ask to join your family by entering a parent’s email. Only approve people you know:
        they will see every reader’s books and ratings.
      </Text>
      {error && <Alert>Something went wrong: {error.message}</Alert>}
      {!error && (loading || !data) && <Loading />}
      {!error && data && requests.length === 0 && <Text color="gray">No one is waiting to join.</Text>}
      {!error && requests.length > 0 && (
        <ul className="card-list">
          {requests.map((request) => (
            <li key={request.id}>
              <Flex align="center" justify="between" gap="3" wrap="wrap">
                <Flex direction="column">
                  <Text weight="medium">{request.email}</Text>
                  <Text size="2" color="gray">
                    Asked on {when(request.requestedAt)}
                  </Text>
                </Flex>
                <Flex gap="2">
                  <Button
                    type="button"
                    size="3"
                    disabled={busy}
                    aria-label={`Approve ${request.email}`}
                    onClick={() => answer(APPROVE_JOIN_REQUEST, request.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="3"
                    variant="soft"
                    color="gray"
                    disabled={busy}
                    aria-label={`Deny ${request.email}`}
                    onClick={() => answer(DENY_JOIN_REQUEST, request.id)}
                  >
                    Deny
                  </Button>
                </Flex>
              </Flex>
            </li>
          ))}
        </ul>
      )}
      {editError && <Alert>Something went wrong: {editError}</Alert>}
    </Panel>
  );
}
