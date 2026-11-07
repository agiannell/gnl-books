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

const build = (authorization: string | undefined) => buildContext({ db, verifier, authorization });

beforeEach(() => {
  findFamilyIdForAccount.mockReset();
  verifier.verify.mockClear();
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
    expect(ctx).toEqual({ db, cognitoSub: 'sub-123', familyId: 'family-1', isParent: false });
  });

  it('has no family before first-run bootstrap', async () => {
    findFamilyIdForAccount.mockResolvedValue(undefined);
    expect((await build('Bearer good')).familyId).toBeNull();
  });
});
