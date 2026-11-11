import { useQuery } from '@apollo/client/react';
import NoFamily from './NoFamily.tsx';
import ProfilePicker from './ProfilePicker.tsx';
import { FAMILY, ME, type FamilyData, type MeData } from './queries.ts';
import { Alert, Loading } from './ui.tsx';

/** A signed-in user with no family sets one up or asks to join one; everyone else picks who is reading. */
export default function Home() {
  const me = useQuery<MeData>(ME);
  const familyId = me.data?.me.familyId;
  const family = useQuery<FamilyData>(FAMILY, { skip: !familyId });

  const error = me.error ?? family.error;
  if (error) return <Alert>Something went wrong: {error.message}</Alert>;
  // Only while there is nothing to show yet. A refetch (someone checking whether a parent has approved
  // them) must not swap the page for a spinner, or the screen they are on would start over.
  if ((me.loading && !me.data) || (family.loading && !family.data)) return <Loading />;
  if (!familyId) return <NoFamily />;
  if (!family.data) return <Loading />;

  return <ProfilePicker familyName={family.data.family.name} profiles={family.data.family.profiles} />;
}
