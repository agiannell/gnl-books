import {
  addManualBook,
  AlreadyBootstrappedError,
  attemptParentUnlock,
  bootstrapFamily,
  BookSourceError,
  cacheHardcoverBook,
  createProfile,
  getFamily,
  getGoal,
  getProfile,
  listProfiles,
  addToShelf,
  DateInFutureError,
  finishEntry,
  listShelf,
  logProgress,
  MAX_GOAL_TARGET,
  MAX_PAGE,
  MIN_GOAL_YEAR,
  MAX_GOAL_YEAR,
  ProgressRejectedError,
  rateEntry,
  exportGoodreadsCsv,
  removeEntry,
  reviewEntry,
  setGoal,
  PIN_PATTERN,
  TooManyProfilesError,
  type BookSearchResult,
  type BookSourceErrorCode,
  type Family,
  type Profile,
  type ProgressSource,
  type ReadingGoal,
  type Shelf,
  type ShelfEntry,
  type StoredBook,
} from '@gnl-books/core';
import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import { GraphQLError } from 'graphql';
import type { Context } from './context';

// All API logic lives here. `lambda.ts` and `dev.ts` only wire it up.

const builder = new SchemaBuilder<{
  Context: Context;
  AuthScopes: { inFamily: boolean; noFamily: boolean; isParent: boolean };
  // The type-level half of the two options below; Pothos needs both.
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: true;
}>({
  plugins: [ScopeAuthPlugin],
  // Pothos fields are nullable by default; PLAN.md's schema is non-null, so
  // nullability is something a field opts into (`nullable: true`).
  defaultFieldNullability: false,
  defaultInputFieldRequiredness: true,
  scopeAuth: {
    authScopes: async (context) => ({
      inFamily: context.familyId !== null,
      noFamily: context.familyId === null,
      isParent: context.isParent,
    }),
    // Without this a refused field is reported as INTERNAL_SERVER_ERROR, which
    // a client cannot tell apart from the server breaking.
    unauthorizedError: () =>
      new GraphQLError('Not authorized', { extensions: { code: 'FORBIDDEN' } }),
  },
});

const AccountRef = builder.objectRef<{ cognitoSub: string; familyId: string | null }>('Account');
AccountRef.implement({
  fields: (t) => ({
    // Null means the caller signed in but has not created a family yet.
    familyId: t.exposeID('familyId', { nullable: true }),
  }),
});

// Goodreads' shelf names contain hyphens, which a GraphQL enum name cannot, so
// the names are spelled out and the stored values stay Goodreads' own.
const ShelfEnum = builder.enumType('Shelf', {
  values: {
    TO_READ: { value: 'to-read' },
    CURRENTLY_READING: { value: 'currently-reading' },
    READ: { value: 'read' },
  } satisfies Record<string, { value: Shelf }>,
});
const ShelfEntryRef = builder.objectRef<ShelfEntry>('ShelfEntry');

// Which client logged it, for the progress log.
const ProgressSourceEnum = builder.enumType('ProgressSource', {
  values: {
    WEB: { value: 'web' },
    ALEXA: { value: 'alexa' },
    WIDGET: { value: 'widget' },
  } satisfies Record<string, { value: ProgressSource }>,
});

const ReadingGoalRef = builder.objectRef<ReadingGoal>('ReadingGoal');
ReadingGoalRef.implement({
  fields: (t) => ({
    profileId: t.exposeID('profileId'),
    year: t.exposeInt('year'),
    target: t.exposeInt('target'),
    // Books finished that year, for the goal ring.
    booksRead: t.exposeInt('booksRead'),
  }),
});

const ProfileRef = builder.objectRef<Profile>('Profile');
ProfileRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    emoji: t.string({ nullable: true, resolve: (profile) => profile.emoji }),
    color: t.string({ nullable: true, resolve: (profile) => profile.color }),
    isParent: t.exposeBoolean('isParent'),
    // The reading goal for a year (default: this year in the family's zone), or null if none is set.
    goal: t.field({
      type: ReadingGoalRef,
      nullable: true,
      authScopes: { inFamily: true },
      args: { year: t.arg.int({ required: false }) },
      resolve: async (profile, args, ctx) => {
        if (args.year != null) requireGoalYear(args.year);
        return (await getGoal(ctx.db, ctx.familyId!, profile.id, args.year ?? undefined)) ?? null;
      },
    }),
    // Scoped to the caller's family, so a profile object can never be used to read another family's shelf.
    shelf: t.field({
      type: [ShelfEntryRef],
      authScopes: { inFamily: true },
      args: { shelf: t.arg({ type: ShelfEnum, required: false }) },
      resolve: (profile, args, ctx) => listShelf(ctx.db, ctx.familyId!, profile.id, args.shelf ?? undefined),
    }),
  }),
});

const FamilyRef = builder.objectRef<Family>('Family');
FamilyRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    // The caller's own family, from the context, whatever family object this hangs off.
    profiles: t.field({
      type: [ProfileRef],
      authScopes: { inFamily: true },
      resolve: (_family, _args, ctx) => listProfiles(ctx.db, ctx.familyId!),
    }),
  }),
});

// A search hit or an imported book. `id` is ours and is null until the book has
// been imported into the library; `sourceId` is the catalog's own.
type BookShape = (BookSearchResult & { id: string | null }) | StoredBook;
const BookRef = builder.objectRef<BookShape>('Book');
BookRef.implement({
  fields: (t) => ({
    id: t.id({ nullable: true, resolve: (book) => book.id }),
    // Null for a book entered by hand, which has no catalog id.
    sourceId: t.string({ nullable: true, resolve: (book) => book.sourceId ?? null }),
    title: t.exposeString('title'),
    subtitle: t.string({ nullable: true, resolve: (book) => book.subtitle ?? null }),
    authors: t.stringList({ resolve: (book) => book.authors }),
    isbn13: t.string({ nullable: true, resolve: (book) => book.isbn13 ?? null }),
    isbn10: t.string({ nullable: true, resolve: (book) => book.isbn10 ?? null }),
    pages: t.int({ nullable: true, resolve: (book) => book.pages ?? null }),
    releaseYear: t.int({ nullable: true, resolve: (book) => book.releaseYear ?? null }),
    coverUrl: t.string({ nullable: true, resolve: (book) => book.coverUrl ?? null }),
    seriesName: t.string({ nullable: true, resolve: (book) => book.seriesName ?? null }),
    seriesPosition: t.float({ nullable: true, resolve: (book) => book.seriesPosition ?? null }),
    description: t.string({ nullable: true, resolve: (book) => book.description ?? null }),
    publisher: t.string({ nullable: true, resolve: (book) => book.publisher ?? null }),
    binding: t.string({ nullable: true, resolve: (book) => book.binding ?? null }),
  }),
});

ShelfEntryRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    profileId: t.exposeID('profileId'),
    shelf: t.field({ type: ShelfEnum, resolve: (entry) => entry.shelf }),
    book: t.field({ type: BookRef, resolve: (entry) => entry.book }),
    rating: t.int({ nullable: true, resolve: (entry) => entry.rating }),
    review: t.string({ nullable: true, resolve: (entry) => entry.review }),
    // Calendar dates as YYYY-MM-DD strings.
    dateAdded: t.exposeString('dateAdded'),
    dateStarted: t.string({ nullable: true, resolve: (entry) => entry.dateStarted }),
    dateRead: t.string({ nullable: true, resolve: (entry) => entry.dateRead }),
    readCount: t.exposeInt('readCount'),
    currentPage: t.int({ nullable: true, resolve: (entry) => entry.currentPage }),
    owned: t.exposeBoolean('owned'),
    tags: t.stringList({ resolve: (entry) => entry.tags }),
  }),
});

const BOOK_SOURCE_FAILURES: Record<BookSourceErrorCode, { code: string; message: string }> = {
  unauthorized: {
    code: 'BOOK_SOURCE_UNAUTHORIZED',
    message: 'Book search is not working: the Hardcover token needs to be renewed',
  },
  rate_limited: { code: 'BOOK_SOURCE_RATE_LIMITED', message: 'Book search is busy. Try again in a moment' },
  timeout: { code: 'BOOK_SOURCE_TIMEOUT', message: 'Book search took too long. Try again' },
  unavailable: { code: 'BOOK_SOURCE_UNAVAILABLE', message: 'Book search is unavailable right now' },
};

/**
 * Runs a catalog call and turns its failure into a coded error the UI can act
 * on. The catalog's own message goes to the logs, not to the caller.
 */
async function viaCatalog<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof BookSourceError)) throw error;
    console.error(error);
    const { code, message } = BOOK_SOURCE_FAILURES[error.code];
    throw new GraphQLError(message, { extensions: { code, retryAfterSeconds: error.retryAfterSeconds } });
  }
}

const MAX_QUERY_LENGTH = 200;

builder.queryType({
  fields: (t) => ({
    // Searches the catalog. Nothing is written: a hit becomes a library book only
    // through importBook.
    searchBooks: t.field({
      type: [BookRef],
      authScopes: { inFamily: true },
      args: { query: t.arg.string() },
      resolve: async (_root, args, ctx) => {
        const query = args.query.trim();
        if (!query || query.length > MAX_QUERY_LENGTH) {
          throw badInput(`Search must be 1 to ${MAX_QUERY_LENGTH} characters`);
        }
        const hits = await viaCatalog(() => ctx.books.search(query));
        return hits.map((hit) => ({ ...hit, id: null }));
      },
    }),

    me: t.field({
      type: AccountRef,
      resolve: (_root, _args, ctx) => ({ cognitoSub: ctx.cognitoSub, familyId: ctx.familyId }),
    }),
    // Null for an id that is not one of this family's profiles, including a
    // malformed id or another family's: the caller learns nothing about those.
    profile: t.field({
      type: ProfileRef,
      nullable: true,
      authScopes: { inFamily: true },
      args: { id: t.arg.id() },
      resolve: async (_root, args, ctx) => (await getProfile(ctx.db, ctx.familyId!, String(args.id))) ?? null,
    }),

    family: t.field({
      type: FamilyRef,
      authScopes: { inFamily: true },
      // The id comes from the context, never from an argument.
      resolve: async (_root, _args, ctx) => {
        const family = await getFamily(ctx.db, ctx.familyId!);
        if (!family) throw new GraphQLError('Family not found');
        return family;
      },
    }),
  }),
});

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function requireName(value: string, label: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 60) throw badInput(`${label} must be 1 to 60 characters`);
  return name;
}

function requireRating(rating: number): void {
  if (rating < 1 || rating > 5) throw badInput('Rating must be 1 to 5');
}

const MAX_REVIEW_CHARACTERS = 5000;

function requireGoalYear(year: number): void {
  if (year < MIN_GOAL_YEAR || year > MAX_GOAL_YEAR) throw badInput(`Year must be ${MIN_GOAL_YEAR} to ${MAX_GOAL_YEAR}`);
}

/** A real YYYY-MM-DD date: "2026-02-30" has the right shape and is not one. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function foundEntry(entry: ShelfEntry | undefined): ShelfEntry {
  if (!entry) throw new GraphQLError('Shelf entry not found', { extensions: { code: 'NOT_FOUND' } });
  return entry;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_EMOJI_CHARACTERS = 8;

const CreateProfileInput = builder.inputType('CreateProfileInput', {
  fields: (t) => ({
    name: t.string(),
    emoji: t.string({ required: false }),
    color: t.string({ required: false }),
    isParent: t.boolean({ required: false }),
  }),
});

// A book the catalog could not find, entered by hand.
const ManualBookInput = builder.inputType('ManualBookInput', {
  fields: (t) => ({
    title: t.string(),
    authors: t.stringList(),
    subtitle: t.string({ required: false }),
    pages: t.int({ required: false }),
    releaseYear: t.int({ required: false }),
    isbn13: t.string({ required: false }),
    isbn10: t.string({ required: false }),
    publisher: t.string({ required: false }),
    description: t.string({ required: false }),
  }),
});

const MAX_AUTHORS = 10;
const MAX_RELEASE_YEAR = 2100;
const MAX_TEXT = 300;
const MAX_DESCRIPTION = 5000;

/** Trimmed text of 1 to `max` characters. */
function requireText(value: string, label: string, max = MAX_TEXT): string {
  const text = value.trim();
  if (text.length < 1 || text.length > max) throw badInput(`${label} must be 1 to ${max} characters`);
  return text;
}

/** The object without its undefined properties, which an optional field cannot hold under exactOptionalPropertyTypes. */
function withoutUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}

/** Trimmed text within a length, or undefined when blank. */
function optionalText(value: string | null | undefined, label: string, max = MAX_TEXT): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.length > max) throw badInput(`${label} must be at most ${max} characters`);
  return text;
}

/** Digits only (hyphens and spaces are allowed on input), checked for shape, not for the check digit. */
function optionalIsbn(value: string | null | undefined, label: string, shape: RegExp): string | undefined {
  const text = value?.replace(/[-\s]/g, '').toUpperCase();
  if (!text) return undefined;
  if (!shape.test(text)) throw badInput(`${label} is not the right length or has invalid characters`);
  return text;
}

function optionalInt(value: number | null | undefined, label: string, min: number, max: number): number | undefined {
  if (value == null) return undefined;
  if (value < min || value > max) throw badInput(`${label} must be ${min} to ${max}`);
  return value;
}

const ParentUnlockRef =builder.objectRef<{ token: string; expiresAt: Date }>('ParentUnlock');
ParentUnlockRef.implement({
  fields: (t) => ({
    // Send this back in the X-Parent-Token header on parent-only calls. It is
    // meant to be held in memory, not stored.
    token: t.exposeString('token'),
    expiresAt: t.string({ resolve: (unlock) => unlock.expiresAt.toISOString() }),
  }),
});

builder.mutationType({
  fields: (t) => ({
    // Checks the family's parent PIN, with a lockout, and returns a short-lived
    // token that makes later requests parents (see parentToken.ts).
    unlockParent: t.field({
      type: ParentUnlockRef,
      authScopes: { inFamily: true },
      args: { pin: t.arg.string() },
      resolve: async (_root, args, ctx) => {
        // A malformed PIN cannot be right, so it is not counted as a guess.
        if (!PIN_PATTERN.test(args.pin)) throw badInput('PIN must be 4 to 8 digits');
        const familyId = ctx.familyId!;

        const result = await attemptParentUnlock(ctx.db, familyId, args.pin);
        if (result.ok === false && result.reason === 'locked') {
          throw new GraphQLError('Too many wrong PINs. Try again later.', {
            extensions: { code: 'PIN_LOCKED', retryAt: result.until.toISOString() },
          });
        }
        if (result.ok === false) {
          throw new GraphQLError('Incorrect PIN', {
            extensions: { code: 'PIN_INCORRECT', attemptsRemaining: result.attemptsRemaining },
          });
        }
        return ctx.parentTokens.issue({ sub: ctx.cognitoSub, familyId });
      },
    }),

    // Called with each parent action so an active parent stays unlocked. It
    // keeps the original start, so the 15-minute cap still counts from the PIN.
    renewParentUnlock: t.field({
      type: ParentUnlockRef,
      authScopes: { isParent: true },
      resolve: (_root, _args, ctx) =>
        ctx.parentTokens.issue({
          sub: ctx.cognitoSub,
          familyId: ctx.familyId!,
          startedAt: ctx.parentUnlockStartedAt!,
        }),
    }),

    // Adds a reader to the family. Parent-only: a kid on the shared tablet must
    // not be able to add or impersonate profiles.
    createProfile: t.field({
      type: ProfileRef,
      authScopes: { isParent: true },
      args: { input: t.arg({ type: CreateProfileInput }) },
      resolve: async (_root, { input }, ctx) => {
        const name = requireName(input.name, 'Name');
        const emoji = input.emoji?.trim() || undefined;
        if (emoji && Array.from(emoji).length > MAX_EMOJI_CHARACTERS) {
          throw badInput(`Emoji must be at most ${MAX_EMOJI_CHARACTERS} characters`);
        }
        const color = input.color?.trim() || undefined;
        if (color && !COLOR.test(color)) throw badInput('Color must look like #3366cc');
        try {
          return await createProfile(ctx.db, ctx.familyId!, { name, emoji, color, isParent: input.isParent ?? false });
        } catch (error) {
          if (error instanceof TooManyProfilesError) {
            throw new GraphQLError(error.message, { extensions: { code: 'LIMIT_REACHED' } });
          }
          throw error;
        }
      },
    }),

    // Any signed-in family member may shelve for any profile (see PLAN.md: the
    // API cannot tell whose session it is). Both ids come from the client, so
    // the profile is checked against the caller's family and the book must exist.
    addToShelf: t.field({
      type: ShelfEntryRef,
      authScopes: { inFamily: true },
      args: { profileId: t.arg.id(), bookId: t.arg.id(), shelf: t.arg({ type: ShelfEnum }) },
      resolve: async (_root, args, ctx) => {
        const entry = await addToShelf(ctx.db, ctx.familyId!, String(args.profileId), String(args.bookId), args.shelf);
        if (!entry) throw new GraphQLError('Profile or book not found', { extensions: { code: 'NOT_FOUND' } });
        return entry;
      },
    }),

    // The three edits below act on an entry id from the client, which the data
    // layer checks belongs to the caller's family (another family's is NOT_FOUND).

    // A rating of 1 to 5, or null to clear it.
    rateBook: t.field({
      type: ShelfEntryRef,
      authScopes: { inFamily: true },
      args: { shelfEntryId: t.arg.id(), rating: t.arg.int({ required: false }) },
      resolve: async (_root, args, ctx) => {
        const rating = args.rating ?? null;
        if (rating !== null) requireRating(rating);
        return foundEntry(await rateEntry(ctx.db, ctx.familyId!, String(args.shelfEntryId), rating));
      },
    }),

    // The review text; blank clears it.
    reviewBook: t.field({
      type: ShelfEntryRef,
      authScopes: { inFamily: true },
      args: { shelfEntryId: t.arg.id(), review: t.arg.string() },
      resolve: async (_root, args, ctx) => {
        const review = args.review.trim();
        if (review.length > MAX_REVIEW_CHARACTERS) throw badInput(`Review must be at most ${MAX_REVIEW_CHARACTERS} characters`);
        return foundEntry(await reviewEntry(ctx.db, ctx.familyId!, String(args.shelfEntryId), review || null));
      },
    }),

    // A target number of books for a year, replacing any earlier one.
    setGoal: t.field({
      type: ReadingGoalRef,
      authScopes: { inFamily: true },
      args: { profileId: t.arg.id(), year: t.arg.int(), target: t.arg.int() },
      resolve: async (_root, args, ctx) => {
        requireGoalYear(args.year);
        if (args.target < 1 || args.target > MAX_GOAL_TARGET) throw badInput(`Target must be 1 to ${MAX_GOAL_TARGET}`);
        const goal = await setGoal(ctx.db, ctx.familyId!, String(args.profileId), args.year, args.target);
        if (!goal) throw new GraphQLError('Profile not found', { extensions: { code: 'NOT_FOUND' } });
        return goal;
      },
    }),

    // "I'm on page 120" (`page`) or "I read 30 pages" (`pagesRead`): exactly one.
    // Appends to the progress log and moves the book's current page; a to-read
    // book becomes currently-reading, and a finished one is refused.
    logProgress: t.field({
      type: ShelfEntryRef,
      authScopes: { inFamily: true },
      args: {
        shelfEntryId: t.arg.id(),
        page: t.arg.int({ required: false }),
        pagesRead: t.arg.int({ required: false }),
        source: t.arg({ type: ProgressSourceEnum }),
      },
      resolve: async (_root, args, ctx) => {
        const { page, pagesRead, source } = args;
        if ((page == null) === (pagesRead == null)) throw badInput('Give either page or pagesRead, not both or neither');
        if (page != null && (page < 0 || page > MAX_PAGE)) throw badInput(`Page must be 0 to ${MAX_PAGE}`);
        if (pagesRead != null && (pagesRead < 1 || pagesRead > MAX_PAGE)) throw badInput(`Pages read must be 1 to ${MAX_PAGE}`);
        const input = page != null ? { page, source } : { pagesRead: pagesRead!, source };
        try {
          return foundEntry(await logProgress(ctx.db, ctx.familyId!, String(args.shelfEntryId), input));
        } catch (error) {
          if (error instanceof ProgressRejectedError) throw badInput(error.message);
          throw error;
        }
      },
    }),

    // Moves the book to "read". `dateRead` is a YYYY-MM-DD date (default: today
    // in the family's zone, or the date already recorded); the future is refused.
    finishBook: t.field({
      type: ShelfEntryRef,
      authScopes: { inFamily: true },
      args: {
        shelfEntryId: t.arg.id(),
        dateRead: t.arg.string({ required: false }),
        rating: t.arg.int({ required: false }),
      },
      resolve: async (_root, args, ctx) => {
        const dateRead = args.dateRead?.trim() || undefined;
        if (dateRead !== undefined && !isCalendarDate(dateRead)) throw badInput('Date must look like 2026-11-08');
        const rating = args.rating ?? undefined;
        if (rating !== undefined) requireRating(rating);
        try {
          return foundEntry(await finishEntry(ctx.db, ctx.familyId!, String(args.shelfEntryId), { dateRead, rating }));
        } catch (error) {
          if (error instanceof DateInFutureError) throw badInput(error.message);
          throw error;
        }
      },
    }),

    // For a book the catalog cannot find. It is kept like an imported one, so it
    // can be shelved by the returned id; it has no catalog id. Nothing ties it
    // to a family, so the only limit on how many a signed-in member can add is
    // the field sizes below.
    addManualBook: t.field({
      type: BookRef,
      authScopes: { inFamily: true },
      args: { input: t.arg({ type: ManualBookInput }) },
      resolve: async (_root, { input }, ctx) => {
        const title = requireText(input.title, 'Title');
        const authors = input.authors.map((a) => requireText(a, 'Author', 200));
        if (authors.length < 1 || authors.length > MAX_AUTHORS) throw badInput(`Give 1 to ${MAX_AUTHORS} authors`);
        const book = {
          title,
          authors,
          subtitle: optionalText(input.subtitle, 'Subtitle'),
          pages: optionalInt(input.pages, 'Pages', 1, MAX_PAGE),
          releaseYear: optionalInt(input.releaseYear, 'Release year', 1000, MAX_RELEASE_YEAR),
          isbn13: optionalIsbn(input.isbn13, 'ISBN-13', /^\d{13}$/),
          isbn10: optionalIsbn(input.isbn10, 'ISBN-10', /^\d{9}[\dX]$/),
          publisher: optionalText(input.publisher, 'Publisher', 200),
          description: optionalText(input.description, 'Description', MAX_DESCRIPTION),
        };
        const id = await addManualBook(ctx.db, withoutUndefined(book));
        return {
          id,
          sourceId: null,
          title,
          authors,
          subtitle: book.subtitle ?? null,
          pages: book.pages ?? null,
          releaseYear: book.releaseYear ?? null,
          isbn13: book.isbn13 ?? null,
          isbn10: book.isbn10 ?? null,
          publisher: book.publisher ?? null,
          description: book.description ?? null,
          coverUrl: null,
          seriesName: null,
          seriesPosition: null,
          binding: null,
        };
      },
    }),

    // Takes a book off a profile's shelf, with its reading history. Parent-only
    // (deleting is behind the PIN, see PLAN.md); the book itself stays in the library.
    removeFromShelf: t.boolean({
      authScopes: { isParent: true },
      args: { shelfEntryId: t.arg.id() },
      resolve: async (_root, args, ctx) => {
        if (!(await removeEntry(ctx.db, ctx.familyId!, String(args.shelfEntryId)))) {
          throw new GraphQLError('Shelf entry not found', { extensions: { code: 'NOT_FOUND' } });
        }
        return true;
      },
    }),

    // One profile's whole shelf as a Goodreads import file. Parent-only (see
    // PLAN.md); the browser turns the string into a download.
    exportGoodreadsCsv: t.string({
      authScopes: { isParent: true },
      args: { profileId: t.arg.id() },
      resolve: async (_root, args, ctx) => {
        const csv = await exportGoodreadsCsv(ctx.db, ctx.familyId!, String(args.profileId));
        if (csv === undefined) throw new GraphQLError('Profile not found', { extensions: { code: 'NOT_FOUND' } });
        return csv;
      },
    }),

    // Fetches the full record for a search hit and keeps it in our own books
    // table, so shelves refer to our id and survive the catalog changing or
    // going away. Importing the same book again returns the same id.
    importBook: t.field({
      type: BookRef,
      authScopes: { inFamily: true },
      args: { sourceId: t.arg.string() },
      resolve: async (_root, args, ctx) => {
        const book = await viaCatalog(() => ctx.books.getById(args.sourceId.trim()));
        if (!book) throw new GraphQLError('Book not found', { extensions: { code: 'NOT_FOUND' } });
        return { ...book, id: await cacheHardcoverBook(ctx.db, book) };
      },
    }),

    // First-run bootstrap. Only a signed-in user with no family can call it, and
    // the account it links is the caller's own, taken from the verified token.
    createFamily: t.field({
      type: FamilyRef,
      authScopes: { noFamily: true },
      args: {
        familyName: t.arg.string(),
        parentName: t.arg.string(),
        pin: t.arg.string(),
      },
      resolve: async (_root, args, ctx) => {
        const familyName = requireName(args.familyName, 'Family name');
        const parentName = requireName(args.parentName, 'Your name');
        if (!PIN_PATTERN.test(args.pin)) throw badInput('PIN must be 4 to 8 digits');
        try {
          return await bootstrapFamily(ctx.db, { cognitoSub: ctx.cognitoSub, familyName, parentName, pin: args.pin });
        } catch (error) {
          if (error instanceof AlreadyBootstrappedError) {
            throw new GraphQLError('You already have a family', { extensions: { code: 'CONFLICT' } });
          }
          throw error;
        }
      },
    }),
  }),
});

export const schema = builder.toSchema();
