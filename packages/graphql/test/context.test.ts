import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const { findFamilyIdForAccount, backfillAccountEmail } = vi.hoisted(() => ({
  findFamilyIdForAccount: vi.fn(),
  backfillAccountEmail: vi.fn(),
}));
vi.mock('@gnl-books/core', () => ({ findFamilyIdForAccount, backfillAccountEmail }));

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
const emails = { verifiedEmail: vi.fn(async (_sub: string): Promise<string | null> => 'Anthony@Example.test') };

const build = (authorization: string | undefined, parentToken?: string) =>
  buildContext({ db, verifier, emails, parentTokens, books, authorization, parentToken });

beforeEach(() => {
  findFamilyIdForAccount.mockReset();
  backfillAccountEmail.mockReset();
  emails.verifiedEmail.mockClear();
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
      verifiedEmail: expect.any(Function),
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

describe('buildContext: filling in an account’s email', () => {
  const buildWith = (checkedEmails?: Set<string>) =>
    buildContext({ db, verifier, emails, checkedEmails, parentTokens, books, authorization: 'Bearer good' });

  it('asks core to store the email for a user who has a family, looking it up only if core needs it', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    await buildWith();
    expect(backfillAccountEmail).toHaveBeenCalledWith(db, 'sub-123', expect.any(Function));
    // Core decides whether it needs the email; nothing has been looked up yet.
    expect(emails.verifiedEmail).not.toHaveBeenCalled();
    const lookup = backfillAccountEmail.mock.calls[0][2] as () => Promise<string | null>;
    expect(await lookup()).toBe('Anthony@Example.test');
    expect(emails.verifiedEmail).toHaveBeenCalledWith('sub-123');
  });

  it('shares one Cognito lookup between the backfill and a field that asks for the email', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    backfillAccountEmail.mockImplementation(async (_db, _sub, lookup: () => Promise<string | null>) => void (await lookup()));
    const ctx = await buildWith();
    await ctx.verifiedEmail();
    expect(emails.verifiedEmail).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a user with no family yet', async () => {
    findFamilyIdForAccount.mockResolvedValue(undefined);
    await buildWith();
    expect(backfillAccountEmail).not.toHaveBeenCalled();
  });

  it('checks a user once per container, not on every request', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    const checked = new Set<string>();
    await buildWith(checked);
    await buildWith(checked);
    await buildWith(checked);
    expect(backfillAccountEmail).toHaveBeenCalledTimes(1);
    expect(checked.has('sub-123')).toBe(true);
  });

  it('never fails the request when the email cannot be stored, and tries again on the next one', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    backfillAccountEmail.mockRejectedValueOnce(new Error('cognito unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const checked = new Set<string>();
    await expect(buildWith(checked)).resolves.toMatchObject({ familyId: 'family-1' });
    expect(checked.has('sub-123')).toBe(false);
    expect(log).toHaveBeenCalled();

    await buildWith(checked);
    expect(backfillAccountEmail).toHaveBeenCalledTimes(2);
    expect(checked.has('sub-123')).toBe(true);
    log.mockRestore();
  });
});

describe('buildContext: the verified email', () => {
  beforeEach(() => findFamilyIdForAccount.mockResolvedValue('family-1'));

  it('is not looked up unless something asks for it, so ordinary requests pay nothing', async () => {
    await build('Bearer good');
    expect(emails.verifiedEmail).not.toHaveBeenCalled();
  });

  it('is looked up by the verified token’s subject, once per request however often it is asked', async () => {
    const ctx = await build('Bearer good');
    expect(await ctx.verifiedEmail()).toBe('Anthony@Example.test');
    expect(await ctx.verifiedEmail()).toBe('Anthony@Example.test');
    expect(emails.verifiedEmail).toHaveBeenCalledTimes(1);
    expect(emails.verifiedEmail).toHaveBeenCalledWith('sub-123');
  });

  it('is null when Cognito has no verified email', async () => {
    emails.verifiedEmail.mockResolvedValueOnce(null);
    expect(await (await build('Bearer good')).verifiedEmail()).toBeNull();
  });

  it('is asked again for the next request, which may be a different user', async () => {
    await (await build('Bearer good')).verifiedEmail();
    await (await build('Bearer good')).verifiedEmail();
    expect(emails.verifiedEmail).toHaveBeenCalledTimes(2);
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
