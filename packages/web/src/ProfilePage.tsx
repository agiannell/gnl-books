import { useQuery } from '@apollo/client/react';
import { Link, useParams } from 'react-router';
import GoalProgress from './GoalProgress.tsx';
import NotFound from './NotFound.tsx';
import { PROFILE, type ProfileData } from './queries.ts';
import Shelves from './Shelves.tsx';

/** One reader's page: their goal and their shelves. */
export default function ProfilePage() {
  const { profileId = '' } = useParams();
  const { data, loading, error } = useQuery<ProfileData>(PROFILE, { variables: { id: profileId } });

  if (error) return <p role="alert">Something went wrong: {error.message}</p>;
  if (loading || !data) return <p>Loading…</p>;
  // The API answers null for another family's id and for a malformed one alike.
  if (!data.profile) return <NotFound />;

  const { emoji, name, goal, shelf } = data.profile;
  return (
    <>
      <h1>
        {emoji && <span aria-hidden="true">{emoji} </span>}
        {name}
      </h1>
      {goal && <GoalProgress goal={goal} />}
      <Shelves items={shelf} />
      <p>
        <Link to="/">Switch reader</Link>
      </p>
    </>
  );
}
