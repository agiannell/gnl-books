import { useQuery } from '@apollo/client/react';
import CreateFamily from './CreateFamily.tsx';
import { FAMILY, ME, type FamilyData, type MeData } from './queries.ts';

/** The family's profiles; a signed-in user with no family is asked to set one up first. */
export default function Home() {
  const me = useQuery<MeData>(ME);
  const familyId = me.data?.me.familyId;
  const family = useQuery<FamilyData>(FAMILY, { skip: !familyId });

  const error = me.error ?? family.error;
  if (error) return <p role="alert">Something went wrong: {error.message}</p>;
  if (me.loading || family.loading) return <p>Loading…</p>;
  if (!familyId) return <CreateFamily />;
  if (!family.data) return <p>Loading…</p>;

  const { name, profiles } = family.data.family;
  return (
    <>
      <h1>{name}</h1>
      <ul>
        {profiles.map((profile) => (
          <li key={profile.id}>
            {profile.emoji} {profile.name}
            {profile.isParent && ' (parent)'}
          </li>
        ))}
      </ul>
    </>
  );
}
