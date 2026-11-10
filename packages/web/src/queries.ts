import { gql } from '@apollo/client';

export const ME = gql`
  query Me {
    me {
      familyId
    }
  }
`;

export const FAMILY = gql`
  query Family {
    family {
      name
      profiles {
        id
        name
        emoji
        color
      }
    }
  }
`;

export const PROFILE = gql`
  query ProfilePage($id: ID!) {
    profile(id: $id) {
      id
      name
      emoji
      color
    }
  }
`;

export const CREATE_FAMILY = gql`
  mutation CreateFamily($familyName: String!, $parentName: String!, $pin: String!) {
    createFamily(familyName: $familyName, parentName: $parentName, pin: $pin) {
      id
    }
  }
`;

export interface MeData {
  me: { familyId: string | null };
}

/** A reader, as the picker and the profile page show them. */
export interface ProfileSummary {
  id: string;
  name: string;
  emoji: string | null;
  /** `#rrggbb`; the API only accepts that shape, so it is safe in a style. */
  color: string | null;
}

export interface FamilyData {
  family: { name: string; profiles: ProfileSummary[] };
}

export interface ProfileData {
  /** Null for an id that is not one of this family's profiles. */
  profile: ProfileSummary | null;
}
