import {
  AlreadyBootstrappedError,
  attemptParentUnlock,
  bootstrapFamily,
  BookSourceError,
  cacheHardcoverBook,
  createProfile,
  getFamily,
  getProfile,
  listProfiles,
  addToShelf,
  listShelf,
  PIN_PATTERN,
  TooManyProfilesError,
  type BookSearchResult,
  type BookSourceErrorCode,
  type Family,
  type Profile,
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

const ProfileRef = builder.objectRef<Profile>('Profile');
ProfileRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    emoji: t.string({ nullable: true, resolve: (profile) => profile.emoji }),
    color: t.string({ nullable: true, resolve: (profile) => profile.color }),
    isParent: t.exposeBoolean('isParent'),
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

const ParentUnlockRef = builder.objectRef<{ token: string; expiresAt: Date }>('ParentUnlock');
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
