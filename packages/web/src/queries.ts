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
        isParent
      }
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

export interface FamilyData {
  family: {
    name: string;
    profiles: { id: string; name: string; emoji: string | null; isParent: boolean }[];
  };
}
