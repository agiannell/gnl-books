import { useQuery } from '@apollo/client/react';
import { MagnifyingGlassIcon, PersonIcon } from '@radix-ui/react-icons';
import { Button, Flex, Heading } from '@radix-ui/themes';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import GoalProgress from './GoalProgress.tsx';
import NotFound from './NotFound.tsx';
import { PROFILE, type ProfileData } from './queries.ts';
import Shelves from './Shelves.tsx';
import { Alert, Loading } from './ui.tsx';

/** One reader's page: their goal and their shelves. */
export default function ProfilePage() {
  const { profileId = '' } = useParams();
  // Show what is cached at once but always ask again: books are added on the search page, where this
  // query is not active, so a refetch from there would not reach it.
  const { data, loading, error } = useQuery<ProfileData>(PROFILE, {
    variables: { id: profileId },
    fetchPolicy: 'cache-and-network',
  });

  if (error) return <Alert>Something went wrong: {error.message}</Alert>;
  if (loading || !data) return <Loading />;
  // The API answers null for another family's id and for a malformed one alike.
  if (!data.profile) return <NotFound />;

  const { emoji, name, color, goal, shelf } = data.profile;
  return (
    <Flex direction="column" gap="5">
      <Flex align="center" justify="between" gap="4" wrap="wrap">
        <div
          className="page-title"
          // The API only accepts `#rrggbb` for a colour, so it is safe to put in a style.
          style={color ? ({ '--reader-color': color } as CSSProperties) : undefined}
        >
          <span className="reader-avatar" aria-hidden="true">
            {emoji ?? <PersonIcon width={28} height={28} />}
          </span>
          <Heading as="h1" size={{ initial: '7', sm: '8' }}>
            {name}
          </Heading>
        </div>
        <Button asChild size="3">
          <Link to={`/p/${profileId}/search`}>
            <MagnifyingGlassIcon aria-hidden="true" />
            Find a book
          </Link>
        </Button>
      </Flex>
      {goal && <GoalProgress goal={goal} />}
      <Shelves items={shelf} profileId={profileId} />
      <Flex>
        <Button asChild variant="ghost" color="gray">
          <Link to="/">Switch reader</Link>
        </Button>
      </Flex>
    </Flex>
  );
}
