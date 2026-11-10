import { useQuery } from '@apollo/client/react';
import CreateFamily from './CreateFamily.tsx';
import ProfilePicker from './ProfilePicker.tsx';
import { FAMILY, ME, type FamilyData, type MeData } from './queries.ts';

/** A signed-in user with no family sets one up; everyone else picks who is reading. */
export default function Home() {
  const me = useQuery<MeData>(ME);
  const familyId = me.data?.me.familyId;
  const family = useQuery<FamilyData>(FAMILY, { skip: !familyId });

  const error = me.error ?? family.error;
  if (error) return <p role="alert">Something went wrong: {error.message}</p>;
  if (me.loading || family.loading) return <p>Loading…</p>;
  if (!familyId) return <CreateFamily />;
  if (!family.data) return <p>Loading…</p>;

  return <ProfilePicker familyName={family.data.family.name} profiles={family.data.family.profiles} />;
}
