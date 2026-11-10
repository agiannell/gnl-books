import { useQuery } from '@apollo/client/react';
import { Link, useParams } from 'react-router';
import NotFound from './NotFound.tsx';
import { PROFILE, type ProfileData } from './queries.ts';

/** One reader's page. The shelves come next; for now it only names the reader. */
export default function ProfilePage() {
  const { profileId = '' } = useParams();
  const { data, loading, error } = useQuery<ProfileData>(PROFILE, { variables: { id: profileId } });

  if (error) return <p role="alert">Something went wrong: {error.message}</p>;
  if (loading || !data) return <p>Loading…</p>;
  // The API answers null for another family's id and for a malformed one alike.
  if (!data.profile) return <NotFound />;

  const { emoji, name } = data.profile;
  return (
    <>
      <h1>
        {emoji && <span aria-hidden="true">{emoji} </span>}
        {name}
      </h1>
      <p>Their shelves are coming soon.</p>
      <p>
        <Link to="/">Switch reader</Link>
      </p>
    </>
  );
}
