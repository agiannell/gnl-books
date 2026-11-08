import { graphql } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const { getFamily, bootstrapFamily, attemptParentUnlock } = vi.hoisted(() => ({
  getFamily: vi.fn(),
  bootstrapFamily: vi.fn(),
  attemptParentUnlock: vi.fn(),
}));
// Only what touches the database is mocked; the PIN rule and the error class
// are the real ones, so these tests cannot drift from core.
vi.mock('@gnl-books/core', async () => {
  const actual = await vi.importActual<typeof import('@gnl-books/core')>('@gnl-books/core');
  return { ...actual, getFamily, bootstrapFamily, attemptParentUnlock };
});
import { AlreadyBootstrappedError } from '@gnl-books/core';

import type { Context } from '../src/context';
import { schema } from '../src/schema';

const db = {} as Db;
const expiresAt = new Date('2026-11-08T12:02:00Z');
const parentTokens = { issue: vi.fn(), verify: vi.fn() };
const run = (source: string, context: Partial<Context> = {}) =>
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
      ...context,
    },
  });

beforeEach(() => {
  getFamily.mockReset();
  bootstrapFamily.mockReset();
  attemptParentUnlock.mockReset();
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
