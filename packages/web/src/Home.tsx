import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';

const ME = gql`
  query Me {
    me {
      familyId
    }
  }
`;

const FAMILY = gql`
  query Family {
    family {
      name
      profiles {
        id
        name
        emoji
        isParent
      }
    }
  }
`;

interface MeData {
  me: { familyId: string | null };
}

interface FamilyData {
  family: {
    name: string;
    profiles: { id: string; name: string; emoji: string | null; isParent: boolean }[];
  };
}

/** For now: proves the sign-in and the API work together by showing the family. */
export default function Home() {
  const me = useQuery<MeData>(ME);
  const familyId = me.data?.me.familyId;
  const family = useQuery<FamilyData>(FAMILY, { skip: !familyId });

  const error = me.error ?? family.error;
  if (error) return <p role="alert">Something went wrong: {error.message}</p>;
  if (me.loading || family.loading) return <p>Loading…</p>;
  if (!familyId) return <p>You’re signed in, but there’s no family yet. Setting one up comes next.</p>;
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
