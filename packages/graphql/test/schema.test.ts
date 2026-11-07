import { graphql } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const { getFamily } = vi.hoisted(() => ({ getFamily: vi.fn() }));
vi.mock('@gnl-books/core', () => ({ getFamily }));

import type { Context } from '../src/context';
import { schema } from '../src/schema';

const db = {} as Db;
const run = (source: string, context: Partial<Context> = {}) =>
  graphql({
    schema,
    source,
    contextValue: { db, cognitoSub: 'sub-123', familyId: null, isParent: false, ...context },
  });

beforeEach(() => getFamily.mockReset());

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
