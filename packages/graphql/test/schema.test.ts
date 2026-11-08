import { graphql } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const { getFamily, bootstrapFamily, attemptParentUnlock, cacheHardcoverBook, listProfiles, getProfile, createProfile } =
  vi.hoisted(() => ({
    getFamily: vi.fn(),
    bootstrapFamily: vi.fn(),
    attemptParentUnlock: vi.fn(),
    cacheHardcoverBook: vi.fn(),
    listProfiles: vi.fn(),
    getProfile: vi.fn(),
    createProfile: vi.fn(),
  }));
// Only what touches the database is mocked; the PIN rule and the error classes
// are the real ones, so these tests cannot drift from core.
vi.mock('@gnl-books/core', async () => {
  const actual = await vi.importActual<typeof import('@gnl-books/core')>('@gnl-books/core');
  return { ...actual, getFamily, bootstrapFamily, attemptParentUnlock, cacheHardcoverBook, listProfiles, getProfile, createProfile };
});
import { AlreadyBootstrappedError, BookSourceError, TooManyProfilesError } from '@gnl-books/core';

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
