import { graphql } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const {
  getFamily,
  bootstrapFamily,
  attemptParentUnlock,
  cacheHardcoverBook,
  listProfiles,
  getProfile,
  createProfile,
  addToShelf,
  listShelf,
  rateEntry,
  reviewEntry,
  finishEntry,
  logProgress,
  getGoal,
  setGoal,
  addManualBook,
  removeEntry,
  exportGoodreadsCsv,
  getBook,
  removeGoal,
  deleteProfile,
} = vi.hoisted(() => ({
  getFamily: vi.fn(),
  bootstrapFamily: vi.fn(),
  attemptParentUnlock: vi.fn(),
  cacheHardcoverBook: vi.fn(),
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
  createProfile: vi.fn(),
  addToShelf: vi.fn(),
  listShelf: vi.fn(),
  rateEntry: vi.fn(),
  reviewEntry: vi.fn(),
  finishEntry: vi.fn(),
  logProgress: vi.fn(),
  getGoal: vi.fn(),
  setGoal: vi.fn(),
  addManualBook: vi.fn(),
  removeEntry: vi.fn(),
  exportGoodreadsCsv: vi.fn(),
  getBook: vi.fn(),
  removeGoal: vi.fn(),
  deleteProfile: vi.fn(),
}));
// Only what touches the database is mocked; the PIN rule and the error classes
// are the real ones, so these tests cannot drift from core.
vi.mock('@gnl-books/core', async () => {
  const actual = await vi.importActual<typeof import('@gnl-books/core')>('@gnl-books/core');
  return {
    ...actual,
    getFamily,
    bootstrapFamily,
    attemptParentUnlock,
    cacheHardcoverBook,
    listProfiles,
    getProfile,
    createProfile,
    addToShelf,
    listShelf,
    rateEntry,
    reviewEntry,
    finishEntry,
    logProgress,
    getGoal,
    setGoal,
    addManualBook,
    removeEntry,
    exportGoodreadsCsv,
    getBook,
    removeGoal,
    deleteProfile,
  };
});
import {
  AlreadyBootstrappedError,
  BookSourceError,
  DateInFutureError,
  ProgressRejectedError,
  LastProfileError,
  TooManyProfilesError,
} from '@gnl-books/core';

import type { Context } from '../src/context';
import { schema } from '../src/schema';

const db = {} as Db;
const expiresAt = new Date('2026-11-08T12:02:00Z');
const parentTokens = { issue: vi.fn(), verify: vi.fn() };
const books = { name: 'hardcover' as const, search: vi.fn(), getById: vi.fn() };
const run =(source: string, context: Partial<Context> = {}) =>
  graphql({
    schema,
    source,
    contextValue: {
      db,
      cognitoSub: 'sub-123',
      familyId: null,
      isParent: false,
      parentUnlockStartedAt: null,
      parentTokens,
      books,
      ...context,
    },
  });

beforeEach(() => {
  getFamily.mockReset();
  bootstrapFamily.mockReset();
  attemptParentUnlock.mockReset();
  cacheHardcoverBook.mockReset();
  listProfiles.mockReset();
  getProfile.mockReset();
  createProfile.mockReset();
  addToShelf.mockReset();
  listShelf.mockReset();
  rateEntry.mockReset();
  reviewEntry.mockReset();
  finishEntry.mockReset();
  logProgress.mockReset();
  getGoal.mockReset();
  setGoal.mockReset();
  addManualBook.mockReset();
  removeEntry.mockReset();
  exportGoodreadsCsv.mockReset();
  getBook.mockReset();
  removeGoal.mockReset();
  deleteProfile.mockReset();
  books.search.mockReset();
  books.getById.mockReset();
  parentTokens.issue.mockReset().mockResolvedValue({ token: 'new-token', expiresAt });
});

describe('me', () => {
  it('reports no family before bootstrap', async () => {
    const result = await run('{ me { familyId } }');
    expect(result).toEqual({ data: { me: { familyId: null } } });
  });

  it('reports the caller’s family', async () => {
    const result = await run('{ me { familyId } }', { familyId: 'family-1' });
    expect(result).toEqual({ data: { me: { familyId: 'family-1' } } });
  });
});

describe('family', () => {
  it('is refused before the caller has a family, and never touches the database', async () => {
    const result = await run('{ family { name } }');
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.message).toMatch(/not authorized/i);
    // A refusal is FORBIDDEN, not INTERNAL_SERVER_ERROR, so a client can tell them apart.
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(getFamily).not.toHaveBeenCalled();
  });

  it('reads the family named by the context, not by anything the client sends', async () => {
    getFamily.mockResolvedValue({ id: 'family-1', name: 'Giannell' });
    const result = await run('{ family { id name } }', { familyId: 'family-1' });
    expect(getFamily).toHaveBeenCalledWith(db, 'family-1');
    expect(result).toEqual({ data: { family: { id: 'family-1', name: 'Giannell' } } });
  });

  it('takes no arguments, so an id cannot be passed', async () => {
    const result = await run('{ family(id: "someone-elses") { name } }', { familyId: 'family-1' });
    expect(result.errors?.[0]?.message).toMatch(/unknown argument/i);
    expect(getFamily).not.toHaveBeenCalled();
  });

  it('never exposes the PIN hash', async () => {
    const result = await run('{ family { parentPinHash } }', { familyId: 'family-1' });
    expect(result.errors?.[0]?.message).toMatch(/cannot query field/i);
  });
});

describe('createFamily', () => {
  const mutation = (args = 'familyName: "Giannell", parentName: "Anthony", pin: "4821"') =>
    `mutation { createFamily(${args}) { id name } }`;

  it('creates the family for the signed-in user, from the verified identity', async () => {
    bootstrapFamily.mockResolvedValue({ id: 'family-1', name: 'Giannell' });
    const result = await run(mutation(), { cognitoSub: 'sub-from-token' });
    expect(result).toEqual({ data: { createFamily: { id: 'family-1', name: 'Giannell' } } });
    expect(bootstrapFamily).toHaveBeenCalledWith(db, {
      cognitoSub: 'sub-from-token',
      familyName: 'Giannell',
      parentName: 'Anthony',
      pin: '4821',
    });
  });

  it('trims the names', async () => {
    bootstrapFamily.mockResolvedValue({ id: 'family-1', name: 'Giannell' });
    await run(mutation('familyName: "  Giannell ", parentName: " Anthony  ", pin: "4821"'));
    expect(bootstrapFamily).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ familyName: 'Giannell', parentName: 'Anthony' }),
    );
  });

  it('is refused, FORBIDDEN, for someone who already has a family', async () => {
    const result = await run(mutation(), { familyId: 'family-1' });
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(bootstrapFamily).not.toHaveBeenCalled();
  });

  it.each([
    ['a short PIN', 'familyName: "G", parentName: "A", pin: "123"'],
    ['a long PIN', 'familyName: "G", parentName: "A", pin: "123456789"'],
    ['a PIN with letters', 'familyName: "G", parentName: "A", pin: "12ab"'],
    ['an empty family name', 'familyName: "  ", parentName: "A", pin: "4821"'],
    ['an empty parent name', 'familyName: "G", parentName: "", pin: "4821"'],
    ['an over-long name', `familyName: "${'x'.repeat(61)}", parentName: "A", pin: "4821"`],
  ])('rejects %s with BAD_USER_INPUT before touching the database', async (_name, args) => {
    const result = await run(mutation(args));
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(bootstrapFamily).not.toHaveBeenCalled();
  });

  it('reports a lost race as CONFLICT', async () => {
    bootstrapFamily.mockRejectedValue(new AlreadyBootstrappedError());
    const result = await run(mutation());
    expect(result.errors?.[0]?.extensions?.code).toBe('CONFLICT');
  });

  it('does not dress an unexpected failure up as a user error', async () => {
    bootstrapFamily.mockRejectedValue(new Error('connection reset'));
    const result = await run(mutation());
    // (Apollo adds INTERNAL_SERVER_ERROR and masks the message; see access.test.ts.)
    expect(result.errors).toHaveLength(1);
    expect(['CONFLICT', 'BAD_USER_INPUT', 'FORBIDDEN']).not.toContain(result.errors?.[0]?.extensions?.code);
  });

  it('requires all three arguments', async () => {
    const result = await run('mutation { createFamily(familyName: "G") { id } }');
    expect(result.errors?.[0]?.message).toMatch(/required/i);
    expect(bootstrapFamily).not.toHaveBeenCalled();
  });
});

describe('unlockParent', () => {
  const unlock = (pin = '4821') => `mutation { unlockParent(pin: "${pin}") { token expiresAt } }`;
  const member = { familyId: 'family-1' };

  it('returns a token for the right PIN, issued for the verified user and family', async () => {
    attemptParentUnlock.mockResolvedValue({ ok: true });
    const result = await run(unlock(), { ...member, cognitoSub: 'sub-from-token' });
    expect(result).toEqual({
      data: { unlockParent: { token: 'new-token', expiresAt: '2026-11-08T12:02:00.000Z' } },
    });
    expect(attemptParentUnlock).toHaveBeenCalledWith(db, 'family-1', '4821');
    // A fresh unlock has no `startedAt`: the cap counts from now.
    expect(parentTokens.issue).toHaveBeenCalledWith({ sub: 'sub-from-token', familyId: 'family-1' });
  });

  it('says how many tries are left after a wrong PIN, and issues nothing', async () => {
    attemptParentUnlock.mockResolvedValue({ ok: false, reason: 'wrong', attemptsRemaining: 3 });
    const result = await run(unlock('0000'), member);
    expect(result.errors?.[0]?.extensions).toMatchObject({ code: 'PIN_INCORRECT', attemptsRemaining: 3 });
    expect(result.data).toBeNull();
    expect(parentTokens.issue).not.toHaveBeenCalled();
  });

  it('says when to try again once locked, and issues nothing', async () => {
    const until = new Date('2026-11-08T12:15:00Z');
    attemptParentUnlock.mockResolvedValue({ ok: false, reason: 'locked', until });
    const result = await run(unlock(), member);
    expect(result.errors?.[0]?.extensions).toMatchObject({ code: 'PIN_LOCKED', retryAt: '2026-11-08T12:15:00.000Z' });
    expect(parentTokens.issue).not.toHaveBeenCalled();
  });

  it.each(['123', '123456789', 'abcd', ''])('rejects the malformed PIN %j without counting it as a guess', async (pin) => {
    const result = await run(unlock(pin), member);
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(attemptParentUnlock).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN before there is a family to unlock', async () => {
    const result = await run(unlock());
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(attemptParentUnlock).not.toHaveBeenCalled();
  });
});

describe('renewParentUnlock', () => {
  const renew = 'mutation { renewParentUnlock { token expiresAt } }';

  it('is FORBIDDEN for someone who has not unlocked, and issues nothing', async () => {
    const result = await run(renew, { familyId: 'family-1', isParent: false });
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(parentTokens.issue).not.toHaveBeenCalled();
  });

  it('renews for an unlocked parent, keeping the original start so the cap still applies', async () => {
    const startedAt = new Date('2026-11-08T11:58:00Z');
    const result = await run(renew, {
      familyId: 'family-1',
      isParent: true,
      parentUnlockStartedAt: startedAt,
      cognitoSub: 'sub-123',
    });
    expect(result.data).toEqual({ renewParentUnlock: { token: 'new-token', expiresAt: '2026-11-08T12:02:00.000Z' } });
    expect(parentTokens.issue).toHaveBeenCalledWith({ sub: 'sub-123', familyId: 'family-1', startedAt });
  });
});

describe('profiles', () => {
  const sam = { id: 'p-1', name: 'Sam', emoji: '🦊', color: '#3366cc', isParent: false };

  it("lists the caller's family's profiles, using the family from the context", async () => {
    getFamily.mockResolvedValue({ id: 'family-1', name: 'Test' });
    listProfiles.mockResolvedValue([sam]);
    const result = await run('{ family { profiles { id name emoji color isParent } } }', { familyId: 'family-1' });
    expect(result.data).toEqual({ family: { profiles: [sam] } });
    expect(listProfiles).toHaveBeenCalledWith(db, 'family-1');
  });

  it('does not list profiles for a caller with no family, even through createFamily', async () => {
    bootstrapFamily.mockResolvedValue({ id: 'new-family', name: 'New' });
    const result = await run(
      'mutation { createFamily(familyName: "New", parentName: "Pat", pin: "4821") { id profiles { id } } }',
    );
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(listProfiles).not.toHaveBeenCalled();
  });

  it('looks a profile up within the caller’s family only', async () => {
    getProfile.mockResolvedValue(sam);
    const result = await run('{ profile(id: "p-1") { name } }', { familyId: 'family-1' });
    expect(result.data).toEqual({ profile: { name: 'Sam' } });
    expect(getProfile).toHaveBeenCalledWith(db, 'family-1', 'p-1');
  });

  it('is null, not an error, for a profile that is not theirs', async () => {
    getProfile.mockResolvedValue(undefined);
    const result = await run('{ profile(id: "someone-elses") { name } }', { familyId: 'family-1' });
    expect(result).toEqual({ data: { profile: null } });
  });

  it('is FORBIDDEN to look up a profile before there is a family, without touching the database', async () => {
    const result = await run('{ profile(id: "p-1") { name } }');
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(getProfile).not.toHaveBeenCalled();
  });
});

describe('createProfile', () => {
  const create = (input: string) => `mutation { createProfile(input: ${input}) { id name emoji color isParent } }`;
  const parent = { familyId: 'family-1', isParent: true };
  const made = { id: 'p-2', name: 'Alex', emoji: null, color: null, isParent: false };

  it('creates a profile in the caller’s family, trimmed, as a non-parent by default', async () => {
    createProfile.mockResolvedValue(made);
    const result = await run(create('{ name: "  Alex  ", emoji: "🦊", color: "#3366CC" }'), parent);
    expect(result.errors).toBeUndefined();
    expect(createProfile).toHaveBeenCalledWith(db, 'family-1', { name: 'Alex', emoji: '🦊', color: '#3366CC', isParent: false });
  });

  it('can make a second adult a parent profile', async () => {
    createProfile.mockResolvedValue({ ...made, isParent: true });
    await run(create('{ name: "Jo", isParent: true }'), parent);
    expect(createProfile).toHaveBeenCalledWith(db, 'family-1', expect.objectContaining({ isParent: true }));
  });

  it('treats a blank emoji or color as not given', async () => {
    createProfile.mockResolvedValue(made);
    await run(create('{ name: "Alex", emoji: "  ", color: "" }'), parent);
    expect(createProfile).toHaveBeenCalledWith(db, 'family-1', { name: 'Alex', emoji: undefined, color: undefined, isParent: false });
  });

  it.each([
    ['an empty name', '{ name: "   " }'],
    ['an over-long name', `{ name: "${'x'.repeat(61)}" }`],
    ['a long emoji', '{ name: "A", emoji: "123456789" }'],
    ['a color without the #', '{ name: "A", color: "3366cc" }'],
    ['a short color', '{ name: "A", color: "#fff" }'],
    ['a color that is not hex', '{ name: "A", color: "#3366zz" }'],
  ])('rejects %s as bad input, writing nothing', async (_name, input) => {
    const result = await run(create(input), parent);
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN unless a parent has unlocked, even for a signed-in family member', async () => {
    const result = await run(create('{ name: "Alex" }'), { familyId: 'family-1', isParent: false });
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('reports the profile limit as LIMIT_REACHED', async () => {
    createProfile.mockRejectedValue(new TooManyProfilesError());
    const result = await run(create('{ name: "Alex" }'), parent);
    expect(result.errors?.[0]?.extensions?.code).toBe('LIMIT_REACHED');
  });
});

describe('searchBooks', () => {
  const search = (query: string) => `{ searchBooks(query: ${JSON.stringify(query)}) { id sourceId title authors pages seriesPosition coverUrl } }`;
  const hit = { sourceId: '101', title: 'Dog Man', authors: ['Dav Pilkey'], pages: 240, seriesPosition: 1 };

  it('returns the catalog hits with no library id, and writes nothing', async () => {
    books.search.mockResolvedValue([hit]);
    const result = await run(search('dog man'), { familyId: 'family-1' });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      searchBooks: [{ id: null, sourceId: '101', title: 'Dog Man', authors: ['Dav Pilkey'], pages: 240, seriesPosition: 1, coverUrl: null }],
    });
    expect(cacheHardcoverBook).not.toHaveBeenCalled();
  });

  it('trims the query before searching', async () => {
    books.search.mockResolvedValue([]);
    await run(search('  dog man  '), { familyId: 'family-1' });
    expect(books.search).toHaveBeenCalledWith('dog man');
  });

  it.each([['an empty query', ''], ['a blank query', '   '], ['an over-long query', 'x'.repeat(201)]])(
    'rejects %s as bad input without calling the catalog',
    async (_name, query) => {
      const result = await run(search(query), { familyId: 'family-1' });
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
      expect(books.search).not.toHaveBeenCalled();
    },
  );

  it('is FORBIDDEN before there is a family, and never calls the catalog', async () => {
    const result = await run(search('dog man'));
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(books.search).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', 'BOOK_SOURCE_UNAUTHORIZED', 'Hardcover token needs to be renewed'],
    ['rate_limited', 'BOOK_SOURCE_RATE_LIMITED', 'busy'],
    ['timeout', 'BOOK_SOURCE_TIMEOUT', 'too long'],
    ['unavailable', 'BOOK_SOURCE_UNAVAILABLE', 'unavailable'],
  ] as const)('reports a %s catalog failure as %s, without the catalog’s own message', async (code, graphqlCode, text) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    books.search.mockRejectedValue(new BookSourceError(code, 'api.hardcover.app said token abc123 is bad', { retryAfterSeconds: 7 }));
    const result = await run(search('dog man'), { familyId: 'family-1' });
    const [error] = result.errors ?? [];
    expect(error?.extensions?.code).toBe(graphqlCode);
    expect(error?.message).toContain(text);
    expect(error?.message).not.toContain('abc123');
    expect(error?.extensions?.retryAfterSeconds).toBe(7);
  });
});

describe('importBook', () => {
  const imp = 'mutation { importBook(sourceId: " 101 ") { id sourceId title publisher } }';
  const detail = { sourceId: '101', title: 'Dog Man', authors: ['Dav Pilkey'], publisher: 'Graphix' };

  it('caches the full record and returns our id with it', async () => {
    books.getById.mockResolvedValue(detail);
    cacheHardcoverBook.mockResolvedValue('book-uuid');
    const result = await run(imp, { familyId: 'family-1' });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ importBook: { id: 'book-uuid', sourceId: '101', title: 'Dog Man', publisher: 'Graphix' } });
    expect(books.getById).toHaveBeenCalledWith('101');
    expect(cacheHardcoverBook).toHaveBeenCalledWith(db, detail);
  });

  it('is NOT_FOUND when the catalog has no such book, and caches nothing', async () => {
    books.getById.mockResolvedValue(null);
    const result = await run(imp, { familyId: 'family-1' });
    expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(cacheHardcoverBook).not.toHaveBeenCalled();
  });

  it('caches nothing when the catalog fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    books.getById.mockRejectedValue(new BookSourceError('unavailable', 'down'));
    const result = await run(imp, { familyId: 'family-1' });
    expect(result.errors?.[0]?.extensions?.code).toBe('BOOK_SOURCE_UNAVAILABLE');
    expect(cacheHardcoverBook).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN before there is a family, and touches neither the catalog nor the database', async () => {
    const result = await run(imp);
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(books.getById).not.toHaveBeenCalled();
    expect(cacheHardcoverBook).not.toHaveBeenCalled();
  });
});

describe('addToShelf', () => {
  const add = (shelf = 'CURRENTLY_READING') =>
    `mutation { addToShelf(profileId: "p-1", bookId: "b-1", shelf: ${shelf}) {
      id profileId shelf dateStarted tags book { id title sourceId seriesPosition } } }`;
  const entry = {
    id: 'e-1',
    profileId: 'p-1',
    shelf: 'currently-reading',
    rating: null,
    review: null,
    dateAdded: '2026-11-08',
    dateStarted: '2026-11-08',
    dateRead: null,
    readCount: 1,
    currentPage: null,
    owned: false,
    tags: [],
    book: { id: 'b-1', sourceId: null, title: 'My Book', authors: ['A'], seriesPosition: 2.5 },
  };

  it('shelves for the profile and book named, in the caller’s family, using the stored shelf value', async () => {
    addToShelf.mockResolvedValue(entry);
    const result = await run(add(), { familyId: 'family-1' });
    expect(result.errors).toBeUndefined();
    expect(addToShelf).toHaveBeenCalledWith(db, 'family-1', 'p-1', 'b-1', 'currently-reading');
    expect(result.data).toEqual({
      addToShelf: {
        id: 'e-1',
        profileId: 'p-1',
        shelf: 'CURRENTLY_READING',
        dateStarted: '2026-11-08',
        tags: [],
        // A hand-entered book has no catalog id.
        book: { id: 'b-1', title: 'My Book', sourceId: null, seriesPosition: 2.5 },
      },
    });
  });

  it('is NOT_FOUND for a profile outside the family or a missing book', async () => {
    addToShelf.mockResolvedValue(undefined);
    const result = await run(add('READ'), { familyId: 'family-1' });
    expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
  });

  it('refuses a shelf that is not one of the three', async () => {
    const result = await run(add('FAVORITES'), { familyId: 'family-1' });
    expect(result.errors).toBeDefined();
    expect(addToShelf).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN before there is a family, without touching the database', async () => {
    const result = await run(add());
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(addToShelf).not.toHaveBeenCalled();
  });

  it('needs no parent unlock: any signed-in family member can shelve', async () => {
    addToShelf.mockResolvedValue(entry);
    const result = await run(add(), { familyId: 'family-1', isParent: false });
    expect(result.errors).toBeUndefined();
  });
});

describe('Profile.shelf', () => {
  const q = (arg = '') => `{ profile(id: "p-1") { shelf${arg} { id book { title } } } }`;

  it('lists the profile’s shelf within the caller’s family, optionally one shelf', async () => {
    getProfile.mockResolvedValue({ id: 'p-1', name: 'Sam', emoji: null, color: null, isParent: false });
    listShelf.mockResolvedValue([{ id: 'e-1', book: { title: 'My Book' } }]);
    const all = await run(q(), { familyId: 'family-1' });
    expect(all.data).toEqual({ profile: { shelf: [{ id: 'e-1', book: { title: 'My Book' } }] } });
    expect(listShelf).toHaveBeenLastCalledWith(db, 'family-1', 'p-1', undefined);

    await run(q('(shelf: TO_READ)'), { familyId: 'family-1' });
    expect(listShelf).toHaveBeenLastCalledWith(db, 'family-1', 'p-1', 'to-read');
  });
});

describe('rating, reviewing and finishing', () => {
  const entry = {
    id: 'e-1',
    profileId: 'p-1',
    shelf: 'read',
    rating: 4,
    review: 'Good',
    dateAdded: '2026-11-08',
    dateStarted: null,
    dateRead: '2026-11-09',
    readCount: 1,
    currentPage: null,
    owned: false,
    tags: [],
    book: { id: 'b-1', sourceId: null, title: 'My Book', authors: [] },
  };
  const family = { familyId: 'family-1' };
  const rate = (rating: string) => `mutation { rateBook(shelfEntryId: "e-1", rating: ${rating}) { rating } }`;
  const review = (text: string) => `mutation { reviewBook(shelfEntryId: "e-1", review: ${JSON.stringify(text)}) { review } }`;
  const finish = (args = '') => `mutation { finishBook(shelfEntryId: "e-1"${args}) { shelf dateRead rating } }`;
  const code = (r: { errors?: readonly { extensions?: Record<string, unknown> }[] }) => r.errors?.[0]?.extensions?.code;

  describe('rateBook', () => {
    it.each([1, 3, 5])('rates %i in the caller’s family', async (n) => {
      rateEntry.mockResolvedValue({ ...entry, rating: n });
      const result = await run(rate(String(n)), family);
      expect(result.data).toEqual({ rateBook: { rating: n } });
      expect(rateEntry).toHaveBeenCalledWith(db, 'family-1', 'e-1', n);
    });

    it('clears the rating with null', async () => {
      rateEntry.mockResolvedValue({ ...entry, rating: null });
      await run(rate('null'), family);
      expect(rateEntry).toHaveBeenCalledWith(db, 'family-1', 'e-1', null);
    });

    it.each(['0', '6', '-1', '100'])('refuses %s as BAD_USER_INPUT, without touching the database', async (n) => {
      expect(code(await run(rate(n), family))).toBe('BAD_USER_INPUT');
      expect(rateEntry).not.toHaveBeenCalled();
    });

    it('is NOT_FOUND for an entry outside the family', async () => {
      rateEntry.mockResolvedValue(undefined);
      expect(code(await run(rate('3'), family))).toBe('NOT_FOUND');
    });

    it('is FORBIDDEN before there is a family, without touching the database', async () => {
      expect(code(await run(rate('3')))).toBe('FORBIDDEN');
      expect(rateEntry).not.toHaveBeenCalled();
    });
  });

  describe('reviewBook', () => {
    it('saves the trimmed text', async () => {
      reviewEntry.mockResolvedValue(entry);
      await run(review('  Loved it  '), family);
      expect(reviewEntry).toHaveBeenCalledWith(db, 'family-1', 'e-1', 'Loved it');
    });

    it('clears the review when it is blank', async () => {
      reviewEntry.mockResolvedValue({ ...entry, review: null });
      await run(review('   '), family);
      expect(reviewEntry).toHaveBeenCalledWith(db, 'family-1', 'e-1', null);
    });

    it('accepts 5000 characters and refuses 5001', async () => {
      reviewEntry.mockResolvedValue(entry);
      expect((await run(review('x'.repeat(5000)), family)).errors).toBeUndefined();
      reviewEntry.mockClear();
      expect(code(await run(review('x'.repeat(5001)), family))).toBe('BAD_USER_INPUT');
      expect(reviewEntry).not.toHaveBeenCalled();
    });

    it('is NOT_FOUND for an entry outside the family, and FORBIDDEN with no family', async () => {
      reviewEntry.mockResolvedValue(undefined);
      expect(code(await run(review('hi'), family))).toBe('NOT_FOUND');
      reviewEntry.mockClear();
      expect(code(await run(review('hi')))).toBe('FORBIDDEN');
      expect(reviewEntry).not.toHaveBeenCalled();
    });
  });

  describe('finishBook', () => {
    it('finishes with no date or rating, leaving both to the data layer', async () => {
      finishEntry.mockResolvedValue(entry);
      const result = await run(finish(), family);
      expect(result.data).toEqual({ finishBook: { shelf: 'READ', dateRead: '2026-11-09', rating: 4 } });
      expect(finishEntry).toHaveBeenCalledWith(db, 'family-1', 'e-1', { dateRead: undefined, rating: undefined });
    });

    it('passes the date and rating given', async () => {
      finishEntry.mockResolvedValue(entry);
      await run(finish(', dateRead: " 2025-02-28 ", rating: 5'), family);
      expect(finishEntry).toHaveBeenCalledWith(db, 'family-1', 'e-1', { dateRead: '2025-02-28', rating: 5 });
    });

    it.each(['2026-02-30', '2026-13-01', '26-1-1', 'yesterday', '2026-11-08T10:00:00Z', '0001-01-01', "2026-01-01'; --"])(
      'refuses the date %j as BAD_USER_INPUT, without touching the database',
      async (date) => {
        expect(code(await run(finish(`, dateRead: ${JSON.stringify(date)}`), family))).toBe('BAD_USER_INPUT');
        expect(finishEntry).not.toHaveBeenCalled();
      },
    );

    it('accepts 29 February in a leap year', async () => {
      finishEntry.mockResolvedValue(entry);
      expect((await run(finish(', dateRead: "2024-02-29"'), family)).errors).toBeUndefined();
    });

    it('refuses a rating out of range', async () => {
      expect(code(await run(finish(', rating: 9'), family))).toBe('BAD_USER_INPUT');
      expect(finishEntry).not.toHaveBeenCalled();
    });

    it('reports a future date as BAD_USER_INPUT', async () => {
      finishEntry.mockRejectedValue(new DateInFutureError());
      expect(code(await run(finish(', dateRead: "2999-01-01"'), family))).toBe('BAD_USER_INPUT');
    });

    it('does not dress an unexpected failure up as a user error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      finishEntry.mockRejectedValue(new Error('connection reset'));
      expect(code(await run(finish(), family))).not.toBe('BAD_USER_INPUT');
    });

    it('is NOT_FOUND for an entry outside the family, and FORBIDDEN with no family', async () => {
      finishEntry.mockResolvedValue(undefined);
      expect(code(await run(finish(), family))).toBe('NOT_FOUND');
      finishEntry.mockClear();
      expect(code(await run(finish()))).toBe('FORBIDDEN');
      expect(finishEntry).not.toHaveBeenCalled();
    });
  });

  describe('logProgress', () => {
    const log = (args: string) => `mutation { logProgress(shelfEntryId: "e-1", ${args}) { shelf currentPage } }`;
    const moved = { ...entry, shelf: 'currently-reading', currentPage: 50 };

    it('logs pages read, with the source as the stored value', async () => {
      logProgress.mockResolvedValue(moved);
      const result = await run(log('pagesRead: 30, source: ALEXA'), family);
      expect(result.data).toEqual({ logProgress: { shelf: 'CURRENTLY_READING', currentPage: 50 } });
      expect(logProgress).toHaveBeenCalledWith(db, 'family-1', 'e-1', { pagesRead: 30, source: 'alexa' });
    });

    it('logs a page', async () => {
      logProgress.mockResolvedValue(moved);
      await run(log('page: 120, source: WEB'), family);
      expect(logProgress).toHaveBeenCalledWith(db, 'family-1', 'e-1', { page: 120, source: 'web' });
    });

    it('accepts page 0, a reset', async () => {
      logProgress.mockResolvedValue(moved);
      expect((await run(log('page: 0, source: WIDGET'), family)).errors).toBeUndefined();
      expect(logProgress).toHaveBeenCalledWith(db, 'family-1', 'e-1', { page: 0, source: 'widget' });
    });

    it.each([
      ['neither', 'source: WEB'],
      ['both', 'page: 10, pagesRead: 5, source: WEB'],
      ['a negative page', 'page: -1, source: WEB'],
      ['a page beyond the cap', 'page: 100001, source: WEB'],
      ['zero pages read', 'pagesRead: 0, source: WEB'],
      ['negative pages read', 'pagesRead: -5, source: WEB'],
      ['pages read beyond the cap', 'pagesRead: 100001, source: WEB'],
    ])('refuses %s as BAD_USER_INPUT, without touching the database', async (_name, args) => {
      expect(code(await run(log(args), family))).toBe('BAD_USER_INPUT');
      expect(logProgress).not.toHaveBeenCalled();
    });

    it('refuses an unknown source at validation', async () => {
      expect((await run(log('pagesRead: 5, source: CARRIER_PIGEON'), family)).errors).toBeDefined();
      expect(logProgress).not.toHaveBeenCalled();
    });

    it('reports a finished book or a page past the end as BAD_USER_INPUT, with the reason', async () => {
      logProgress.mockRejectedValue(new ProgressRejectedError('This book has 120 pages'));
      const result = await run(log('page: 500, source: WEB'), family);
      expect(code(result)).toBe('BAD_USER_INPUT');
      expect(result.errors?.[0]?.message).toBe('This book has 120 pages');
    });

    it('does not dress an unexpected failure up as a user error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      logProgress.mockRejectedValue(new Error('connection reset'));
      expect(code(await run(log('pagesRead: 5, source: WEB'), family))).not.toBe('BAD_USER_INPUT');
    });

    it('is NOT_FOUND for an entry outside the family, and FORBIDDEN with no family', async () => {
      logProgress.mockResolvedValue(undefined);
      expect(code(await run(log('pagesRead: 5, source: WEB'), family))).toBe('NOT_FOUND');
      logProgress.mockClear();
      expect(code(await run(log('pagesRead: 5, source: WEB')))).toBe('FORBIDDEN');
      expect(logProgress).not.toHaveBeenCalled();
    });
  });
});

describe('reading goals', () => {
  const family = { familyId: 'family-1' };
  const goal = { profileId: 'p-1', year: 2026, target: 30, booksRead: 7 };
  const code = (r: { errors?: readonly { extensions?: Record<string, unknown> }[] }) => r.errors?.[0]?.extensions?.code;
  const set = (year: number, target: number) =>
    `mutation { setGoal(profileId: "p-1", year: ${year}, target: ${target}) { profileId year target booksRead } }`;

  describe('setGoal', () => {
    it('sets the goal for the profile, in the caller’s family, and returns the progress', async () => {
      setGoal.mockResolvedValue(goal);
      const result = await run(set(2026, 30), family);
      expect(result.data).toEqual({ setGoal: goal });
      expect(setGoal).toHaveBeenCalledWith(db, 'family-1', 'p-1', 2026, 30);
    });

    it.each([
      [2026, 1],
      [2026, 1000],
      [2000, 5],
      [2100, 5],
    ])('accepts year %i with target %i', async (year, target) => {
      setGoal.mockResolvedValue(goal);
      expect((await run(set(year, target), family)).errors).toBeUndefined();
    });

    it.each([
      ['a target of 0', 2026, 0],
      ['a negative target', 2026, -1],
      ['a target over 1000', 2026, 1001],
      ['a year before 2000', 1999, 5],
      ['a year after 2100', 2101, 5],
      ['an absurd year', 2147483647, 5],
    ])('refuses %s as BAD_USER_INPUT, without touching the database', async (_name, year, target) => {
      expect(code(await run(set(year, target), family))).toBe('BAD_USER_INPUT');
      expect(setGoal).not.toHaveBeenCalled();
    });

    it('is NOT_FOUND for a profile outside the family, and FORBIDDEN with no family', async () => {
      setGoal.mockResolvedValue(undefined);
      expect(code(await run(set(2026, 30), family))).toBe('NOT_FOUND');
      setGoal.mockClear();
      expect(code(await run(set(2026, 30)))).toBe('FORBIDDEN');
      expect(setGoal).not.toHaveBeenCalled();
    });
  });

  describe('Profile.goal', () => {
    const q = (arg = '') => `{ profile(id: "p-1") { goal${arg} { year target booksRead } } }`;
    const profile = { id: 'p-1', name: 'Sam', emoji: null, color: null, isParent: false };

    it('reads the goal for the current year when no year is given', async () => {
      getProfile.mockResolvedValue(profile);
      getGoal.mockResolvedValue(goal);
      const result = await run(q(), family);
      expect(result.data).toEqual({ profile: { goal: { year: 2026, target: 30, booksRead: 7 } } });
      expect(getGoal).toHaveBeenCalledWith(db, 'family-1', 'p-1', undefined);
    });

    it('reads the year asked for', async () => {
      getProfile.mockResolvedValue(profile);
      getGoal.mockResolvedValue(goal);
      await run(q('(year: 2025)'), family);
      expect(getGoal).toHaveBeenCalledWith(db, 'family-1', 'p-1', 2025);
    });

    it('is null when no goal is set', async () => {
      getProfile.mockResolvedValue(profile);
      getGoal.mockResolvedValue(undefined);
      expect((await run(q(), family)).data).toEqual({ profile: { goal: null } });
    });

    it('refuses an out-of-range year, without touching the database', async () => {
      getProfile.mockResolvedValue(profile);
      expect(code(await run(q('(year: 2147483647)'), family))).toBe('BAD_USER_INPUT');
      expect(getGoal).not.toHaveBeenCalled();
    });
  });
});

describe('addManualBook', () => {
  const family = { familyId: 'family-1' };
  const code = (r: { errors?: readonly { extensions?: Record<string, unknown> }[] }) => r.errors?.[0]?.extensions?.code;
  const add = (fields: string) =>
    `mutation { addManualBook(input: { ${fields} }) { id sourceId title authors subtitle pages releaseYear isbn13 isbn10 publisher description coverUrl } }`;
  const base = 'title: "Homemade", authors: ["Me"]';

  it('stores the book and returns it with our id and no catalog id, trimmed', async () => {
    addManualBook.mockResolvedValue('book-uuid');
    const result = await run(
      add('title: "  Homemade  ", authors: [" Me ", "You"], subtitle: " A tale ", pages: 120, releaseYear: 2020, publisher: " Home Press "'),
      family,
    );
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      addManualBook: {
        id: 'book-uuid',
        sourceId: null,
        title: 'Homemade',
        authors: ['Me', 'You'],
        subtitle: 'A tale',
        pages: 120,
        releaseYear: 2020,
        isbn13: null,
        isbn10: null,
        publisher: 'Home Press',
        description: null,
        coverUrl: null,
      },
    });
    // Blank and missing fields are left out, not passed as undefined or empty.
    expect(addManualBook).toHaveBeenCalledWith(db, {
      title: 'Homemade',
      authors: ['Me', 'You'],
      subtitle: 'A tale',
      pages: 120,
      releaseYear: 2020,
      publisher: 'Home Press',
    });
  });

  it('treats blank optional fields as not given', async () => {
    addManualBook.mockResolvedValue('book-uuid');
    await run(add(`${base}, subtitle: "  ", publisher: "", description: " ", isbn13: " "`), family);
    expect(addManualBook).toHaveBeenCalledWith(db, { title: 'Homemade', authors: ['Me'] });
  });

  it('normalises ISBNs: hyphens and spaces dropped, a trailing x upper-cased', async () => {
    addManualBook.mockResolvedValue('book-uuid');
    await run(add(`${base}, isbn13: "978-0-545-58160-8", isbn10: "0 8044 2957 x"`), family);
    expect(addManualBook).toHaveBeenCalledWith(db, expect.objectContaining({ isbn13: '9780545581608', isbn10: '080442957X' }));
  });

  it.each([
    ['a blank title', 'title: "  ", authors: ["Me"]'],
    ['a title over 300 characters', `title: "${'x'.repeat(301)}", authors: ["Me"]`],
    ['no authors', 'title: "T", authors: []'],
    ['a blank author', 'title: "T", authors: [" "]'],
    ['more than 10 authors', `title: "T", authors: [${Array(11).fill('"A"').join(',')}]`],
    ['an author over 200 characters', `title: "T", authors: ["${'x'.repeat(201)}"]`],
    ['a subtitle over 300 characters', `${base}, subtitle: "${'x'.repeat(301)}"`],
    ['a publisher over 200 characters', `${base}, publisher: "${'x'.repeat(201)}"`],
    ['a description over 5000 characters', `${base}, description: "${'x'.repeat(5001)}"`],
    ['zero pages', `${base}, pages: 0`],
    ['pages over the cap', `${base}, pages: 100001`],
    ['a release year before 1000', `${base}, releaseYear: 999`],
    ['a release year after 2100', `${base}, releaseYear: 2101`],
    ['a short ISBN-13', `${base}, isbn13: "12345"`],
    ['an ISBN-13 with letters', `${base}, isbn13: "97805455816XX"`],
    ['an ISBN-10 with an X in the middle', `${base}, isbn10: "08X4429570"`],
  ])('refuses %s as BAD_USER_INPUT, storing nothing', async (_name, fields) => {
    expect(code(await run(add(fields), family))).toBe('BAD_USER_INPUT');
    expect(addManualBook).not.toHaveBeenCalled();
  });

  it('accepts the limits themselves', async () => {
    addManualBook.mockResolvedValue('book-uuid');
    const fields = `title: "${'x'.repeat(300)}", authors: [${Array(10).fill('"A"').join(',')}], pages: 100000, releaseYear: 1000, description: "${'x'.repeat(5000)}"`;
    expect((await run(add(fields), family)).errors).toBeUndefined();
  });

  it('is FORBIDDEN before there is a family, without touching the database', async () => {
    expect(code(await run(add(base)))).toBe('FORBIDDEN');
    expect(addManualBook).not.toHaveBeenCalled();
  });
});

describe('removeFromShelf', () => {
  const remove = 'mutation { removeFromShelf(shelfEntryId: "e-1") }';
  const code = (r: { errors?: readonly { extensions?: Record<string, unknown> }[] }) => r.errors?.[0]?.extensions?.code;

  it('removes the entry for an unlocked parent, in the caller’s family', async () => {
    removeEntry.mockResolvedValue(true);
    const result = await run(remove, { familyId: 'family-1', isParent: true });
    expect(result.data).toEqual({ removeFromShelf: true });
    expect(removeEntry).toHaveBeenCalledWith(db, 'family-1', 'e-1');
  });

  it('is FORBIDDEN for a signed-in family member who has not unlocked, without touching the database', async () => {
    const result = await run(remove, { familyId: 'family-1', isParent: false });
    expect(code(result)).toBe('FORBIDDEN');
    expect(removeEntry).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN before there is a family', async () => {
    expect(code(await run(remove))).toBe('FORBIDDEN');
    expect(removeEntry).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for an entry outside the family or already removed', async () => {
    removeEntry.mockResolvedValue(false);
    expect(code(await run(remove, { familyId: 'family-1', isParent: true }))).toBe('NOT_FOUND');
  });
});

describe('exportGoodreadsCsv', () => {
  const exportCsv = 'mutation { exportGoodreadsCsv(profileId: "p-1") }';
  const code = (r: { errors?: readonly { extensions?: Record<string, unknown> }[] }) => r.errors?.[0]?.extensions?.code;

  it('returns the file for an unlocked parent, in the caller’s family', async () => {
    exportGoodreadsCsv.mockResolvedValue('Title\n');
    const result = await run(exportCsv, { familyId: 'family-1', isParent: true });
    expect(result.data).toEqual({ exportGoodreadsCsv: 'Title\n' });
    expect(exportGoodreadsCsv).toHaveBeenCalledWith(db, 'family-1', 'p-1');
  });

  it('is FORBIDDEN for a signed-in family member who has not unlocked, without touching the database', async () => {
    expect(code(await run(exportCsv, { familyId: 'family-1', isParent: false }))).toBe('FORBIDDEN');
    expect(exportGoodreadsCsv).not.toHaveBeenCalled();
  });

  it('is FORBIDDEN before there is a family', async () => {
    expect(code(await run(exportCsv))).toBe('FORBIDDEN');
    expect(exportGoodreadsCsv).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a profile outside the family', async () => {
    exportGoodreadsCsv.mockResolvedValue(undefined);
    expect(code(await run(exportCsv, { familyId: 'family-1', isParent: true }))).toBe('NOT_FOUND');
  });
});

const codeOf = (r: { errors?: readonly { extensions?: Record<string, unknown> }[] }) => r.errors?.[0]?.extensions?.code;

describe('book(id)', () => {
  const q = '{ book(id: "b-1") { id title sourceId authors } }';
  const stored = { id: 'b-1', sourceId: null, title: 'T', authors: ['A'], subtitle: null };

  it('returns the library book to a signed-in family member', async () => {
    getBook.mockResolvedValue(stored);
    const result = await run(q, { familyId: 'family-1' });
    expect(result.data).toEqual({ book: { id: 'b-1', title: 'T', sourceId: null, authors: ['A'] } });
    expect(getBook).toHaveBeenCalledWith(db, 'b-1');
  });

  it('is null for an unknown id', async () => {
    getBook.mockResolvedValue(undefined);
    expect((await run(q, { familyId: 'family-1' })).data).toEqual({ book: null });
  });

  it('is FORBIDDEN before there is a family, without touching the database', async () => {
    expect(codeOf(await run(q))).toBe('FORBIDDEN');
    expect(getBook).not.toHaveBeenCalled();
  });
});

describe('removeGoal', () => {
  const remove = (year = 2026) => `mutation { removeGoal(profileId: "p-1", year: ${year}) }`;
  const family = { familyId: 'family-1' };

  it('removes the goal for any family member, in the caller’s family', async () => {
    removeGoal.mockResolvedValue(true);
    expect((await run(remove(), family)).data).toEqual({ removeGoal: true });
    expect(removeGoal).toHaveBeenCalledWith(db, 'family-1', 'p-1', 2026);
  });

  it.each([1999, 2101, 2147483647])('refuses year %i as BAD_USER_INPUT, without touching the database', async (year) => {
    expect(codeOf(await run(remove(year), family))).toBe('BAD_USER_INPUT');
    expect(removeGoal).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND when there is no such goal or profile, and FORBIDDEN with no family', async () => {
    removeGoal.mockResolvedValue(false);
    expect(codeOf(await run(remove(), family))).toBe('NOT_FOUND');
    removeGoal.mockClear();
    expect(codeOf(await run(remove()))).toBe('FORBIDDEN');
    expect(removeGoal).not.toHaveBeenCalled();
  });
});

describe('deleteProfile', () => {
  const del = 'mutation { deleteProfile(profileId: "p-1") }';

  it('deletes the profile for an unlocked parent, in the caller’s family', async () => {
    deleteProfile.mockResolvedValue(true);
    expect((await run(del, { familyId: 'family-1', isParent: true })).data).toEqual({ deleteProfile: true });
    expect(deleteProfile).toHaveBeenCalledWith(db, 'family-1', 'p-1');
  });

  it('is FORBIDDEN for a family member who has not unlocked, and before there is a family, without touching the database', async () => {
    expect(codeOf(await run(del, { familyId: 'family-1', isParent: false }))).toBe('FORBIDDEN');
    expect(codeOf(await run(del))).toBe('FORBIDDEN');
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a profile outside the family', async () => {
    deleteProfile.mockResolvedValue(false);
    expect(codeOf(await run(del, { familyId: 'family-1', isParent: true }))).toBe('NOT_FOUND');
  });

  it('is BAD_USER_INPUT for the family’s last profile', async () => {
    deleteProfile.mockRejectedValue(new LastProfileError());
    const result = await run(del, { familyId: 'family-1', isParent: true });
    expect(codeOf(result)).toBe('BAD_USER_INPUT');
    expect(result.errors?.[0]?.message).toBe('A family needs at least one profile');
  });
});
