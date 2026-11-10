import { gql } from '@apollo/client';

export const ME = gql`
  query Me {
    me {
      familyId
    }
  }
`;

// Every query for the family asks for its id: with it Apollo stores the family as one object and
// merges what each query reads. Without it, a query that skips `name` replaces the whole object
// and the other queries lose theirs.
export const FAMILY = gql`
  query Family {
    family {
      id
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

// The fields of a shelf entry that the book page edits. Every edit returns these, and since
// Apollo stores an entry by its id, the page and the shelves both update from the reply.
const ENTRY_FIELDS = `
  id
  shelf
  rating
  review
  dateRead
  currentPage
`;

// The book page finds its entry in the reader's shelf by book id: a family's shelf is small,
// and the API has no lookup of one entry by book.
export const BOOK_PAGE = gql`
  query BookPage($id: ID!) {
    profile(id: $id) {
      id
      name
      shelf {
        ${ENTRY_FIELDS}
        book {
          id
          title
          authors
          pages
          releaseYear
          seriesName
          seriesPosition
          description
        }
      }
    }
  }
`;

export const RATE_BOOK = gql`
  mutation RateBook($shelfEntryId: ID!, $rating: Int) {
    rateBook(shelfEntryId: $shelfEntryId, rating: $rating) {
      ${ENTRY_FIELDS}
    }
  }
`;

export const REVIEW_BOOK = gql`
  mutation ReviewBook($shelfEntryId: ID!, $review: String!) {
    reviewBook(shelfEntryId: $shelfEntryId, review: $review) {
      ${ENTRY_FIELDS}
    }
  }
`;

export const LOG_PROGRESS = gql`
  mutation LogProgress($shelfEntryId: ID!, $page: Int) {
    logProgress(shelfEntryId: $shelfEntryId, page: $page, source: WEB) {
      ${ENTRY_FIELDS}
    }
  }
`;

export const FINISH_BOOK = gql`
  mutation FinishBook($shelfEntryId: ID!, $dateRead: String) {
    finishBook(shelfEntryId: $shelfEntryId, dateRead: $dateRead) {
      ${ENTRY_FIELDS}
    }
  }
`;

export const SETTINGS_PROFILES = gql`
  query SettingsProfiles {
    family {
      id
      name
      profiles {
        id
        name
        emoji
        color
        isParent
      }
    }
  }
`;

export const SETTINGS_GOALS = gql`
  query SettingsGoals($year: Int!) {
    family {
      id
      profiles {
        id
        name
        goal(year: $year) {
          year
          target
          booksRead
        }
      }
    }
  }
`;

export const SET_GOAL = gql`
  mutation SetGoal($profileId: ID!, $year: Int!, $target: Int!) {
    setGoal(profileId: $profileId, year: $year, target: $target) {
      year
      target
      booksRead
    }
  }
`;

export const REMOVE_GOAL = gql`
  mutation RemoveGoal($profileId: ID!, $year: Int!) {
    removeGoal(profileId: $profileId, year: $year)
  }
`;

export const CREATE_PROFILE = gql`
  mutation CreateProfile($input: CreateProfileInput!) {
    createProfile(input: $input) {
      id
    }
  }
`;

export const DELETE_PROFILE = gql`
  mutation DeleteProfile($profileId: ID!) {
    deleteProfile(profileId: $profileId)
  }
`;

// The token these return goes in the `X-Parent-Token` header; it is never stored (see parentSession.ts).
export const UNLOCK_PARENT = gql`
  mutation UnlockParent($pin: String!) {
    unlockParent(pin: $pin) {
      token
      expiresAt
    }
  }
`;

export const RENEW_PARENT_UNLOCK = gql`
  mutation RenewParentUnlock {
    renewParentUnlock {
      token
      expiresAt
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

// A book the catalog lacks, typed in by hand. It has no catalog id and is shelved by the id returned here.
export const ADD_MANUAL_BOOK = gql`
  mutation AddManualBook($input: ManualBookInput!) {
    addManualBook(input: $input) {
      id
    }
  }
`;

export const ADD_TO_SHELF = gql`
  mutation AddToShelf($profileId: ID!, $bookId: ID!, $shelf: Shelf!) {
    addToShelf(profileId: $profileId, bookId: $bookId, shelf: $shelf) {
      id
      shelf
      dateRead
      currentPage
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

export interface SettingsProfile extends ProfileSummary {
  isParent: boolean;
}

export interface SettingsProfilesData {
  family: { name: string; profiles: SettingsProfile[] };
}

export interface SettingsGoalsData {
  family: { profiles: { id: string; name: string; goal: GoalSummary | null }[] };
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

/** One entry on the book page: what can be edited, and the book it is about. */
export interface BookPageEntry {
  id: string;
  shelf: ShelfName;
  rating: number | null;
  review: string | null;
  /** `YYYY-MM-DD`. */
  dateRead: string | null;
  currentPage: number | null;
  book: {
    id: string;
    title: string;
    authors: string[];
    pages: number | null;
    releaseYear: number | null;
    seriesName: string | null;
    seriesPosition: number | null;
    description: string | null;
  };
}

export interface BookPageData {
  profile: { id: string; name: string; shelf: BookPageEntry[] } | null;
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
