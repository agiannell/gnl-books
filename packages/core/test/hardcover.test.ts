import { ActionError, AuthenticationError, HardcoverClient, TimeoutError } from '@hardcover/sdk';
import { MockTransport, type MockResponse } from '@hardcover/sdk/testing';
import { describe, expect, it, vi } from 'vitest';
import { createHardcoverSource, type HardcoverClientLike } from '../src/books/hardcover';
import { BookSourceError } from '../src/books/types';

// A stand-in for the SDK client that returns canned data: `hits` are the first page of a search and
// `page2` the second (empty unless given). `search` replaces both, to see or answer each request itself.
function fakeClient(
  over: {
    hits?: unknown[];
    page2?: unknown[];
    search?: HardcoverClientLike['search']['books'];
    book?: unknown;
    editions?: unknown[];
  } = {},
) {
  const calls = { search: vi.fn(), get: vi.fn(), editions: vi.fn() };
  const client: HardcoverClientLike = {
    search: {
      books: async (q, o) => {
        calls.search(q, o);
        if (over.search) return over.search(q, o);
        return { hits: (o?.page ?? 1) === 1 ? (over.hits ?? []) : (over.page2 ?? []) };
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

  it('trims the query, and always asks for the biggest page the API allows, however few are wanted', async () => {
    const { source: s, calls } = source({ hits: [{ id: 1, title: 'A book' }] });
    await s.search('  dog man ', { limit: 1000 });
    await s.search('x', { limit: 1 });
    // Two pages of 25 each time (the second call of each pair is page 2).
    expect(calls.search.mock.calls.map(([q, o]) => [q, o.perPage, o.page])).toEqual([
      ['dog man', 25, 1],
      ['dog man', 25, 2],
      ['x', 25, 1],
      ['x', 25, 2],
    ]);
  });

  it('gives back no more than was asked for, and between 1 and 25', async () => {
    const hits = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Book ${i + 1}`, usersCount: 100 }));
    const { source: s } = source({ hits });
    expect(await s.search('book')).toHaveLength(20);
    expect(await s.search('book', { limit: 3 })).toHaveLength(3);
    expect(await s.search('book', { limit: 0 })).toHaveLength(1);
    expect(await s.search('book', { limit: 1000 })).toHaveLength(25);
  });
});

describe('search pool', () => {
  const book = (id: number, title: string, usersCount = 100, over: Record<string, unknown> = {}) => ({ id, title, usersCount, ...over });
  const results = async (over: Parameters<typeof fakeClient>[0], query = 'anything') => {
    const { source: s, calls } = source(over);
    return { titles: (await s.search(query)).map((r) => r.title), calls };
  };
  const requestsOf = (calls: { search: ReturnType<typeof vi.fn> }) =>
    calls.search.mock.calls.map(([, o]) => [o.page, o.filterBy]);

  it('looks at two pages at once, leaving out box sets', async () => {
    const { calls } = await results({ hits: [book(1, 'A')] });
    expect(requestsOf(calls)).toEqual([
      [1, 'compilation:false'],
      [2, 'compilation:false'],
    ]);
  });

  it('puts the second page after the first', async () => {
    const { titles } = await results({ hits: [book(1, 'One'), book(2, 'Two')], page2: [book(3, 'Three')] });
    expect(titles).toEqual(['One', 'Two', 'Three']);
  });

  it('shows a book once, when both pages have it', async () => {
    const { titles } = await results({ hits: [book(1, 'One'), book(2, 'Two')], page2: [book(2, 'Two again'), book(3, 'Three')] });
    expect(titles).toEqual(['One', 'Two', 'Three']);
  });

  it('finds a series’ later books on the second page, in reader order', async () => {
    const series = ['The Series'];
    const { titles } = await results(
      {
        hits: [book(1, 'The Series Companion', 60, { seriesNames: series }), book(2, 'Book One', 4000, { seriesNames: series })],
        page2: [book(3, 'Book Two', 3500, { seriesNames: series }), book(4, 'Book Three', 3000, { seriesNames: series })],
      },
      'the series',
    );
    expect(titles).toEqual(['Book One', 'Book Two', 'Book Three', 'The Series Companion']);
  });

  it('asks again without the filter when nothing but box sets matches, and shows them', async () => {
    const { source: s, calls } = source({
      search: async (_q, o) => ({ hits: o?.filterBy ? [] : [book(1, 'Boxed Set', 10, { compilation: true })] }),
    });
    expect((await s.search('boxed set')).map((r) => r.title)).toEqual(['Boxed Set']);
    expect(requestsOf(calls)).toEqual([
      [1, 'compilation:false'],
      [2, 'compilation:false'],
      [1, undefined],
      [2, undefined],
    ]);
  });

  it('does not ask again when the filtered search found something', async () => {
    const { calls } = await results({ hits: [book(1, 'A')] });
    expect(calls.search).toHaveBeenCalledTimes(2);
  });

  it('does not ask again, twice over, when there is nothing at all', async () => {
    const { source: s, calls } = source({ hits: [], page2: [] });
    expect(await s.search('zzzz')).toEqual([]);
    // Filtered, then once more without: four requests, no more.
    expect(calls.search).toHaveBeenCalledTimes(4);
  });

  describe('if Hardcover refuses the filter', () => {
    const refuse = (o?: { filterBy?: string }) => {
      if (o?.filterBy) throw new ActionError('search', ['Could not find a filter field named `compilation`'], null);
      return { hits: [book(1, 'Still works')] };
    };

    it('searches without it, so search keeps working', async () => {
      const { source: s, calls } = source({ search: async (_q, o) => refuse(o) });
      expect((await s.search('works')).map((r) => r.title)).toEqual(['Still works']);
      expect(requestsOf(calls).some(([, filter]) => filter === undefined)).toBe(true);
    });

    it('still leaves out the box sets itself, from what it gets back', async () => {
      const { source: s } = source({
        search: async (_q, o) => {
          if (o?.filterBy) throw new ActionError('search', ['no such field'], null);
          return { hits: [book(1, 'The book'), book(2, 'The Complete Collection', 500, { compilation: true })] };
        },
      });
      expect((await s.search('the')).map((r) => r.title)).toEqual(['The book']);
    });

    it('reports a failure of the plain search too', async () => {
      const { source: s } = source({ search: async () => Promise.reject(new ActionError('search', ['down'], null)) });
      await expect(s.search('x')).rejects.toMatchObject({ code: 'unavailable' });
    });
  });

  describe('a failure that is not the filter’s fault', () => {
    it.each([
      ['a bad token', new AuthenticationError('expired'), 'unauthorized'],
      ['a timeout', new TimeoutError('slow'), 'timeout'],
    ])('is reported straight away for %s, without asking again', async (_name, error, code) => {
      const { source: s, calls } = source({ search: async () => Promise.reject(error) });
      await expect(s.search('x')).rejects.toMatchObject({ code });
      // Two pages were asked for at once; nothing was retried.
      expect(calls.search).toHaveBeenCalledTimes(2);
    });

    it('is reported as it is when it is a bug in our own code', async () => {
      const boom = new TypeError('a bug');
      const { source: s } = source({ search: async () => Promise.reject(boom) });
      await expect(s.search('x')).rejects.toBe(boom);
    });
  });
});

describe('search relevance', () => {
  const hit = (id: number, title: string, usersCount?: number, over: Record<string, unknown> = {}) => ({
    id,
    title,
    ...(usersCount !== undefined && { usersCount }),
    ...over,
  });
  const titles = async (hits: unknown[], limit?: number) => {
    const { source: s } = source({ hits });
    return (await s.search('anything', limit === undefined ? {} : { limit })).map((r) => r.title);
  };

  // The numbers are from a real search for "Harry Potter" (852 matches), shortened.
  const harryPotter = [
    hit(1, "Harry Potter and the Philosopher's Stone", 17264, { compilation: false }),
    hit(2, 'Harry Potter and the Chamber of Secrets', 13447, { compilation: false }),
    hit(3, 'Harry Potter and the Cursed Child', 3810, { compilation: false }),
    hit(4, 'Harry Potter: The Complete Collection', 612, { compilation: true }),
    hit(5, 'Harry Potter: The Prequel', 379, { compilation: false }),
    hit(6, 'Harry Potter Boxed Set, Books 1-5', 113, { compilation: true }),
    hit(7, 'The Harry Potter Collection #1-4', 69, { compilation: true }),
    hit(8, 'Harry Potter y la camara secreta by J. K. Rowling', 8, { compilation: false }),
    hit(9, 'Harry Potter i la pedra filosofal', 5, { compilation: false }),
    hit(10, 'Harry Potter i Czara Ognia', 1, { compilation: false }),
  ];

  it('shows the books, not the box sets or the translations, for "Harry Potter"', async () => {
    expect(await titles(harryPotter)).toEqual([
      "Harry Potter and the Philosopher's Stone",
      'Harry Potter and the Chamber of Secrets',
      'Harry Potter and the Cursed Child',
      'Harry Potter: The Prequel',
    ]);
  });

  it('keeps Hardcover’s order, rather than sorting by readers', async () => {
    expect(await titles([hit(1, 'First', 50), hit(2, 'Second', 5000), hit(3, 'Third', 800)])).toEqual(['First', 'Second', 'Third']);
  });

  describe('compilations', () => {
    it('are dropped, however many readers they have', async () => {
      expect(await titles([hit(1, 'A book', 100), hit(2, 'The Complete Collection', 90000, { compilation: true })])).toEqual(['A book']);
    });

    it('do not raise the bar for the real books, even with far more readers', async () => {
      // If the box set counted, the floor would be 450 and this book would be hidden.
      expect(await titles([hit(1, 'Box set', 90000, { compilation: true }), hit(2, 'The real book', 200)])).toEqual(['The real book']);
    });

    it('are only dropped when flagged true', async () => {
      expect(await titles([hit(1, 'Plain', 10), hit(2, 'No flag', 10, { compilation: undefined }), hit(3, 'Not one', 10, { compilation: false })])).toEqual([
        'Plain',
        'No flag',
        'Not one',
      ]);
    });

    it('are all shown when nothing else was found, because an empty list helps nobody', async () => {
      expect(await titles([hit(1, 'Boxed Set 1', 10, { compilation: true }), hit(2, 'Boxed Set 2', 20, { compilation: true })])).toEqual([
        'Boxed Set 1',
        'Boxed Set 2',
      ]);
    });
  });

  describe('the share of the top hit’s readers', () => {
    it('keeps a hit with exactly half a percent of the top, and drops one with less', async () => {
      // 1,000 readers at the top: the floor is 5.
      expect(await titles([hit(1, 'Top', 1000), hit(2, 'At the floor', 5), hit(3, 'Below it', 4)])).toEqual(['Top', 'At the floor']);
    });

    it('keeps everything when the best match is obscure, so a rare title is still found', async () => {
      expect(await titles([hit(1, 'Rare', 12), hit(2, 'Rarer', 3), hit(3, 'Rarest', 1)])).toEqual(['Rare', 'Rarer', 'Rarest']);
    });

    it('keeps hits with no readers at all when nobody has any', async () => {
      expect(await titles([hit(1, 'New', 0), hit(2, 'Newer', 0)])).toEqual(['New', 'Newer']);
    });

    it('drops a hit with no readers once there is a book that has some', async () => {
      expect(await titles([hit(1, 'Read', 400), hit(2, 'Unread', 0)])).toEqual(['Read']);
    });

    it('keeps a hit that does not say how many readers it has', async () => {
      expect(await titles([hit(1, 'Top', 1000), hit(2, 'Unknown')])).toEqual(['Top', 'Unknown']);
    });

    it('measures against the best of the page, however few the caller asks for', async () => {
      const hits = [hit(1, 'Top', 1000), hit(2, 'Second', 600), hit(3, 'Junk', 2)];
      expect(await titles(hits, 1)).toEqual(['Top']);
      expect(await titles(hits, 5)).toEqual(['Top', 'Second']);
    });

    it('lets one hit with an enormous readership hide the rest, as a share of the top should', async () => {
      expect(await titles([hit(1, 'Huge', 1_000_000), hit(2, 'Popular', 4000), hit(3, 'Fine', 6000)])).toEqual(['Huge', 'Fine']);
    });
  });

  it('still reports a hit it cannot use, rather than hiding it in the filter', async () => {
    warn.mockClear();
    expect(await titles([hit(1, 'Good', 100), { id: 2 }, null])).toEqual(['Good']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('shows a single hit, as an ISBN search gives', async () => {
    expect(await titles([hit(1, 'The one', 3)])).toEqual(['The one']);
  });

  it('shows nothing for no hits', async () => {
    expect(await titles([])).toEqual([]);
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

  // Hardcover's ids are 32-bit; a bigger number makes it reject the whole query
  // (seen live: "lies outside the bounds"), which would read as an outage.
  it.each(['', 'abc', '12abc', '-5', '1.5', 'a1', '2147483648', '999999999999'])('is null for the id %j without asking Hardcover', async (id) => {
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
  const searchWith = (response: MockResponse) => {
    const client = new HardcoverClient({
      token: 'hc_pat_0123456789abcdef0123456789abcdef',
      transport: new MockTransport(Array.from({ length: 8 }, () => response)),
      maxRetries: 0,
    });
    return createHardcoverSource({ token: 'unused', client, warn }).search('dog man');
  };
  // (searchWith answers every request the same way: a search asks for two pages at once and may ask again without its filter.)
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
