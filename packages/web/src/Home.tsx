import { useQuery } from '@apollo/client/react';
import CreateFamily from './CreateFamily.tsx';
import ProfilePicker from './ProfilePicker.tsx';
import { FAMILY, ME, type FamilyData, type MeData } from './queries.ts';
import { Alert, Loading } from './ui.tsx';

/** A signed-in user with no family sets one up; everyone else picks who is reading. */
export default function Home() {
  const me = useQuery<MeData>(ME);
  const familyId = me.data?.me.familyId;
  const family = useQuery<FamilyData>(FAMILY, { skip: !familyId });

  const error = me.error ?? family.error;
  if (error) return <Alert>Something went wrong: {error.message}</Alert>;
  if (me.loading || family.loading) return <Loading />;
  if (!familyId) return <CreateFamily />;
  if (!family.data) return <Loading />;

  return <ProfilePicker familyName={family.data.family.name} profiles={family.data.family.profiles} />;
}
