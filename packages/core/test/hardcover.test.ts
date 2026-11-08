import { HardcoverClient } from '@hardcover/sdk';
import { MockTransport, type MockResponse } from '@hardcover/sdk/testing';
import { describe, expect, it, vi } from 'vitest';
import { createHardcoverSource, type HardcoverClientLike } from '../src/books/hardcover';
import { BookSourceError } from '../src/books/types';

// A stand-in for the SDK client that returns canned data.
function fakeClient(over: { hits?: unknown[]; book?: unknown; editions?: unknown[] } = {}) {
  const calls = { search: vi.fn(), get: vi.fn(), editions: vi.fn() };
  const client: HardcoverClientLike = {
    search: {
      books: async (q, o) => {
        calls.search(q, o);
        return { hits: over.hits ?? [] };
      },
    },
    books: {
      get: async (id) => {
        calls.get(id);
        return over.book ?? null;
      },
      editions: async (id, o) => {
        calls.editions(id, o);
        return { items: over.editions ?? [] };
      },
    },
  };
  return { client, calls };
}

const warn = vi.fn();
const source = (over: Parameters<typeof fakeClient>[0] = {}) => {
  const { client, calls } = fakeClient(over);
  return { source: createHardcoverSource({ token: 'unused', client, warn }), calls };
};

describe('search', () => {
  const full = {
    id: 328491,
    title: 'Dog Man',
    subtitle: 'A Graphic Novel',
    authorNames: ['Dav Pilkey', 'Dav Pilkey', 'Jose Garibaldi'],
    isbns: ['9780545581608', '0545581605'],
    pages: 240,
    releaseYear: 2016,
    image: { url: 'https://assets.hardcover.app/cover.jpg', width: 200, height: 300 },
    featuredSeries: { series: { name: 'Dog Man' }, position: 1 },
    featuredSeriesPosition: 1,
    description: 'A hero is born.',
  };

  it('maps a hit to a result', async () => {
    const { source: s } = source({ hits: [full] });
    expect(await s.search('dog man')).toEqual([
      {
        sourceId: '328491',
        title: 'Dog Man',
        subtitle: 'A Graphic Novel',
        authors: ['Dav Pilkey', 'Jose Garibaldi'],
        isbn13: '9780545581608',
        isbn10: '0545581605',
        pages: 240,
        releaseYear: 2016,
        coverUrl: 'https://assets.hardcover.app/cover.jpg',
        seriesName: 'Dog Man',
        seriesPosition: 1,
        description: 'A hero is born.',
      },
    ]);
  });

  it('keeps only what the hit actually had', async () => {
    const { source: s } = source({ hits: [{ id: 7, title: 'Bare' }] });
    expect(await s.search('bare')).toEqual([{ sourceId: '7', title: 'Bare', authors: [] }]);
  });

  it('drops hits it cannot use, and says so', async () => {
    warn.mockClear();
    const bad = [null, 'text', 42, [], {}, { id: 1 }, { title: 'No id' }, { id: 'x', title: 'String id' }, { id: 2, title: '  ' }];
    const { source: s } = source({ hits: [...bad, { id: 9, title: 'Good' }] });
    expect(await s.search('x')).toEqual([{ sourceId: '9', title: 'Good', authors: [] }]);
    expect(warn).toHaveBeenCalledTimes(bad.length);
  });

  it('survives fields of the wrong type instead of throwing', async () => {
    const weird = {
      id: 5,
      title: 'Weird',
      authorNames: 'not an array',
      isbns: [123, null, {}],
      pages: '240',
      releaseYear: Number.NaN,
      image: 'not an object',
      featuredSeries: 'nope',
      seriesNames: [7],
    };
    const { source: s } = source({ hits: [weird] });
    expect(await s.search('weird')).toEqual([{ sourceId: '5', title: 'Weird', authors: [] }]);
  });

  it('accepts hyphenated ISBNs, and an ISBN-10 ending in X', async () => {
    const { source: s } = source({ hits: [{ id: 1, title: 'T', isbns: ['978-0-545-58160-8', '0-8044-2957-x'] }] });
    const [result] = await s.search('t');
    expect(result).toMatchObject({ isbn13: '9780545581608', isbn10: '080442957X' });
  });

  it('ignores a malformed ISBN', async () => {
    const { source: s } = source({ hits: [{ id: 1, title: 'T', isbns: ['12345', 'abc', '97805455816'] }] });
    const [result] = await s.search('t');
    expect(result).not.toHaveProperty('isbn13');
    expect(result).not.toHaveProperty('isbn10');
  });

  it('falls back to the series names when there is no featured series', async () => {
    const { source: s } = source({ hits: [{ id: 1, title: 'T', seriesNames: ['Wings of Fire'] }] });
    expect((await s.search('t'))[0]).toMatchObject({ seriesName: 'Wings of Fire' });
  });

  it('does not call Hardcover for an empty query', async () => {
    const { source: s, calls } = source();
    expect(await s.search('   ')).toEqual([]);
    expect(calls.search).not.toHaveBeenCalled();
  });

  it('trims the query and clamps the page size to what the API allows', async () => {
    const { source: s, calls } = source();
    await s.search('  dog man ', { limit: 1000 });
    await s.search('x', { limit: 0 });
    expect(calls.search).toHaveBeenNthCalledWith(1, 'dog man', { perPage: 25 });
    expect(calls.search).toHaveBeenNthCalledWith(2, 'x', { perPage: 1 });
  });
});

describe('getById', () => {
  const book = {
    id: 328491,
    title: 'Dog Man',
    subtitle: null,
    pages: 240,
    releaseYear: 2016,
    description: 'A hero is born.',
    cachedImage: { url: 'https://assets.hardcover.app/cover.jpg' },
    contributions: [
      { contribution: null, author: { name: 'Dav Pilkey' } },
      { contribution: 'Author', author: { name: 'Dav Pilkey' } },
      { contribution: 'Illustrator', author: { name: 'Someone Else' } },
      { contribution: null, author: null },
    ],
    bookSeries: [{ position: 1, series: { name: 'Dog Man' } }],
  };
  const editions = [
    { isbn13: null, isbn10: null, pages: 99, publisher: { name: 'Audio Co' }, editionFormat: 'Audiobook' },
    { isbn13: '9780545581608', isbn10: '0545581605', pages: 240, publisher: { name: 'Graphix' }, editionFormat: 'Paperback' },
  ];

  it('merges the book with its first edition that has an ISBN-13', async () => {
    const { source: s } = source({ book, editions });
    expect(await s.getById('328491')).toEqual({
      sourceId: '328491',
      title: 'Dog Man',
      authors: ['Dav Pilkey'],
      isbn13: '9780545581608',
      isbn10: '0545581605',
      pages: 240,
      releaseYear: 2016,
      coverUrl: 'https://assets.hardcover.app/cover.jpg',
      seriesName: 'Dog Man',
      seriesPosition: 1,
      description: 'A hero is born.',
      publisher: 'Graphix',
      binding: 'Paperback',
    });
  });

  it('credits only authors, not illustrators or narrators', async () => {
    const { source: s } = source({ book, editions });
    expect((await s.getById('1'))?.authors).toEqual(['Dav Pilkey']);
  });

  it('still returns the book when it has no editions', async () => {
    const { source: s } = source({ book, editions: [] });
    const result = await s.getById('328491');
    expect(result).toMatchObject({ title: 'Dog Man', pages: 240 });
    expect(result).not.toHaveProperty('isbn13');
  });

  it('is null for a book Hardcover does not have', async () => {
    const { source: s } = source({ book: null });
    expect(await s.getById('999')).toBeNull();
  });

  it.each(['', 'abc', '12abc', '-5', '1.5', 'a1'])('is null for the id %j without asking Hardcover', async (id) => {
    const { source: s, calls } = source({ book });
    expect(await s.getById(id)).toBeNull();
    expect(calls.get).not.toHaveBeenCalled();
  });

  it('is null, with a warning, for a book it cannot read', async () => {
    warn.mockClear();
    const { source: s } = source({ book: { id: 1 } });
    expect(await s.getById('1')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

// The real SDK, with its own mock transport: these check what it actually
// throws, which is what the mapping has to handle.
describe('failures, through the real SDK client', () => {
  const searchWith = (...responses: MockResponse[]) => {
    const client = new HardcoverClient({
      token: 'hc_pat_0123456789abcdef0123456789abcdef',
      transport: new MockTransport(responses),
      maxRetries: 0,
    });
    return createHardcoverSource({ token: 'unused', client, warn }).search('dog man');
  };
  const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);

  it('maps an invalid or expired token to unauthorized', async () => {
    const error = await failure(searchWith({ status: 401, body: { error: 'invalid_token', error_description: 'expired' } }));
    expect(error).toBeInstanceOf(BookSourceError);
    expect(error).toMatchObject({ code: 'unauthorized' });
    expect((error as Error).message).toMatch(/read:catalog/);
  });

  it('maps a missing scope to unauthorized', async () => {
    const error = await failure(
      searchWith({ status: 403, body: { error: 'insufficient_scope', error_description: 'x', scope: 'read:catalog' } }),
    );
    expect(error).toMatchObject({ code: 'unauthorized' });
  });

  it('maps a daily rate limit to rate_limited, with how long to wait', async () => {
    const error = await failure(
      searchWith({
        status: 429,
        headers: { 'retry-after': '3600', 'x-ratelimit-limit-daily': '5000', 'x-ratelimit-remaining-daily': '0' },
        body: { error: 'Too Many Requests', message: 'daily' },
      }),
    );
    expect(error).toMatchObject({ code: 'rate_limited' });
    expect((error as BookSourceError).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('maps a server timeout to timeout', async () => {
    const error = await failure(searchWith({ status: 408, body: { error: 'Request timeout' } }));
    expect(error).toMatchObject({ code: 'timeout' });
  });

  it.each([
    ['a 503', { status: 503, body: { error: 'Service temporarily unavailable' } }],
    ['a 500', { status: 500, body: { error: 'An unknown error occurred' } }],
    ['a dropped connection', { network: 'reset' }],
  ] as [string, MockResponse][])('maps %s to unavailable', async (_name, response) => {
    expect(await failure(searchWith(response))).toMatchObject({ code: 'unavailable' });
  });

  it('keeps the SDK error as the cause, for the logs', async () => {
    const error = await failure(searchWith({ status: 401, body: { error: 'invalid_token' } }));
    expect((error as BookSourceError).cause).toBeInstanceOf(Error);
  });

  it('lets an error that is not the SDK’s through unchanged, since it is a bug', async () => {
    const boom = new TypeError('a bug in our code');
    const client: HardcoverClientLike = {
      search: { books: async () => Promise.reject(boom) },
      books: { get: async () => null, editions: async () => ({ items: [] }) },
    };
    await expect(createHardcoverSource({ token: 'unused', client, warn }).search('x')).rejects.toBe(boom);
  });
});
