import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const { findFamilyIdForAccount } = vi.hoisted(() => ({ findFamilyIdForAccount: vi.fn() }));
vi.mock('@gnl-books/core', () => ({ findFamilyIdForAccount }));

import { buildContext } from '../src/context';

const db = {} as Db;
const verifier = {
  verify: vi.fn(async (token: string) => {
    if (token !== 'good') throw new Error('Token expired at 2020-01-01 (internal detail)');
    return { sub: 'sub-123' };
  }),
};

const parentTokens = { issue: vi.fn(), verify: vi.fn() };
const books = { name: 'hardcover' as const, search: vi.fn(), getById: vi.fn() };

const build = (authorization: string | undefined, parentToken?: string) =>
  buildContext({ db, verifier, parentTokens, books, authorization, parentToken });

beforeEach(() => {
  findFamilyIdForAccount.mockReset();
  verifier.verify.mockClear();
  parentTokens.verify.mockReset();
});

describe('buildContext', () => {
  it.each([undefined, '', 'good', 'Basic good', 'Bearer', 'Bearer a b'])(
    'rejects an Authorization header of %j without verifying anything',
    async (header) => {
      await expect(build(header)).rejects.toMatchObject({
        extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
      });
      expect(verifier.verify).not.toHaveBeenCalled();
      expect(findFamilyIdForAccount).not.toHaveBeenCalled();
    },
  );

  it('rejects a token the verifier refuses, without leaking why', async () => {
    const error = await build('Bearer bad').catch((e) => e);
    expect(error.extensions.code).toBe('UNAUTHENTICATED');
    expect(error.message).toBe('Invalid or expired token');
    expect(findFamilyIdForAccount).not.toHaveBeenCalled();
  });

  it('accepts the Bearer scheme in any case', async () => {
    findFamilyIdForAccount.mockResolvedValue(undefined);
    await expect(build('bearer good')).resolves.toMatchObject({ cognitoSub: 'sub-123' });
  });

  it("looks the family up by the verified token's subject", async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    const ctx = await build('Bearer good');
    expect(findFamilyIdForAccount).toHaveBeenCalledWith(db, 'sub-123');
    expect(ctx).toEqual({
      db,
      cognitoSub: 'sub-123',
      familyId: 'family-1',
      isParent: false,
      parentUnlockStartedAt: null,
      parentTokens,
      books,
    });
  });

  it('has no family before first-run bootstrap', async () => {
    findFamilyIdForAccount.mockResolvedValue(undefined);
    expect((await build('Bearer good')).familyId).toBeNull();
  });
});

describe('buildContext: the parent unlock token', () => {
  const startedAt = new Date('2026-11-08T12:00:00Z');

  it('makes the caller a parent when the token verifies', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    parentTokens.verify.mockResolvedValue({ startedAt });
    const ctx = await build('Bearer good', 'unlock-token');
    expect(ctx).toMatchObject({ isParent: true, parentUnlockStartedAt: startedAt });
  });

  it('checks the token against the verified user and family, not anything the client sent', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    parentTokens.verify.mockResolvedValue({ startedAt });
    await build('Bearer good', 'unlock-token');
    expect(parentTokens.verify).toHaveBeenCalledWith('unlock-token', { sub: 'sub-123', familyId: 'family-1' });
  });

  it('is not a parent, and not an error, when the token is expired or forged', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    parentTokens.verify.mockResolvedValue(null);
    const ctx = await build('Bearer good', 'stale-token');
    expect(ctx).toMatchObject({ isParent: false, parentUnlockStartedAt: null });
  });

  it('does not touch the token machinery when no token was sent', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    const ctx = await build('Bearer good');
    expect(ctx.isParent).toBe(false);
    expect(parentTokens.verify).not.toHaveBeenCalled();
  });

  it('ignores a token from someone with no family', async () => {
    findFamilyIdForAccount.mockResolvedValue(undefined);
    const ctx = await build('Bearer good', 'unlock-token');
    expect(ctx.isParent).toBe(false);
    expect(parentTokens.verify).not.toHaveBeenCalled();
  });

  it('still rejects a missing bearer token even if an unlock token is present', async () => {
    await expect(build(undefined, 'unlock-token')).rejects.toMatchObject({
      extensions: { code: 'UNAUTHENTICATED' },
    });
    expect(parentTokens.verify).not.toHaveBeenCalled();
  });
});
