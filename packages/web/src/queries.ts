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
      goal {
        year
        target
        booksRead
      }
      shelf {
        id
        shelf
        rating
        dateRead
        currentPage
        book {
          id
          title
          authors
          pages
          seriesName
          seriesPosition
        }
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

export const SEARCH_BOOKS = gql`
  query SearchBooks($query: String!) {
    searchBooks(query: $query) {
      sourceId
      title
      authors
      pages
      releaseYear
      seriesName
      seriesPosition
    }
  }
`;

// A search hit becomes one of our books only when it is imported; shelves refer to our id.
export const IMPORT_BOOK = gql`
  mutation ImportBook($sourceId: String!) {
    importBook(sourceId: $sourceId) {
      id
    }
  }
`;

export const ADD_TO_SHELF = gql`
  mutation AddToShelf($profileId: ID!, $bookId: ID!, $shelf: Shelf!) {
    addToShelf(profileId: $profileId, bookId: $bookId, shelf: $shelf) {
      id
      shelf
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

export type ShelfName = 'TO_READ' | 'CURRENTLY_READING' | 'READ';

/** One book on a reader's shelf, as the shelves list it. */
export interface ShelfItem {
  id: string;
  shelf: ShelfName;
  rating: number | null;
  /** `YYYY-MM-DD`. */
  dateRead: string | null;
  currentPage: number | null;
  book: {
    id: string;
    title: string;
    authors: string[];
    pages: number | null;
    seriesName: string | null;
    seriesPosition: number | null;
  };
}

/** A catalog hit from the search. `sourceId` is the catalog's id, not ours. */
export interface SearchHit {
  sourceId: string | null;
  title: string;
  authors: string[];
  pages: number | null;
  releaseYear: number | null;
  seriesName: string | null;
  seriesPosition: number | null;
}

export interface GoalSummary {
  year: number;
  target: number;
  /** Books finished that year. */
  booksRead: number;
}

export interface ProfileData {
  /** Null for an id that is not one of this family's profiles. */
  profile: (ProfileSummary & { goal: GoalSummary | null; shelf: ShelfItem[] }) | null;
}
