import { describe, expect, it, vi } from 'vitest';

// The real SDK is not wanted here: the token only has to reach the factory.
const { createHardcoverSource } = vi.hoisted(() => ({ createHardcoverSource: vi.fn() }));
vi.mock('@gnl-books/core', async () => {
  const actual = await vi.importActual<typeof import('@gnl-books/core')>('@gnl-books/core');
  return { ...actual, createHardcoverSource };
});

import { lazyBookSource } from '../src/app';

const source = () => ({ name: 'hardcover' as const, search: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue(null) });

describe('lazyBookSource', () => {
  it('reads the token only when the catalog is first used', async () => {
    const loadToken = vi.fn().mockResolvedValue('tok');
    createHardcoverSource.mockReturnValue(source());
    const books = lazyBookSource(loadToken);
    expect(loadToken).not.toHaveBeenCalled();

    await books.search('a');
    await books.getById('1');
    await books.search('b');
    expect(loadToken).toHaveBeenCalledTimes(1);
    expect(createHardcoverSource).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok', userAgent: 'gnl-books' }));
  });

  it('does not remember a failed load, so a fixed secret works without a redeploy', async () => {
    const loadToken = vi.fn().mockRejectedValueOnce(new Error('no secret yet')).mockResolvedValue('tok');
    const inner = source();
    createHardcoverSource.mockReturnValue(inner);
    const books = lazyBookSource(loadToken);

    await expect(books.search('a')).rejects.toThrow('no secret yet');
    await expect(books.search('a')).resolves.toEqual([]);
    expect(loadToken).toHaveBeenCalledTimes(2);
  });

  it('passes the query and options straight through', async () => {
    const inner = source();
    createHardcoverSource.mockReturnValue(inner);
    await lazyBookSource(async () => 'tok').search('dog man', { limit: 5 });
    expect(inner.search).toHaveBeenCalledWith('dog man', { limit: 5 });
  });
});
