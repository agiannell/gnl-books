import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addManualBook, cacheHardcoverBook } from '../src/books/cache';
import type { BookSearchResult } from '../src/books/types';
import { createDb, type Db } from '../src/db';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. Every row
// it makes is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('book cache (live)', () => {
  let db: Db;
  const made: string[] = [];

  const bookWith = (over: Partial<BookSearchResult> = {}): BookSearchResult => ({
    sourceId: `test-${randomUUID()}`,
    title: 'Dog Man',
    authors: ['Dav Pilkey'],
    ...over,
  });
  const track = (id: string) => (made.push(id), id);
  const rowFor = (id: string) => db.selectFrom('books').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  beforeAll(() => {
    db = createDb({ host: endpoint!, max: 4 });
  });

  afterAll(async () => {
    for (const id of made) await db.deleteFrom('books').where('id', '=', id).execute();
    await db.destroy();
  });

  it('stores a Hardcover book, with authors as a real jsonb array', async () => {
    const book = bookWith({ subtitle: 'Sub', isbn13: '9780545581608', pages: 240, releaseYear: 2016, seriesName: 'Dog Man', seriesPosition: 2.5 });
    const id = track(await cacheHardcoverBook(db, book));
    const row = await rowFor(id);
    expect(row).toMatchObject({
      source: 'hardcover',
      source_id: book.sourceId,
      title: 'Dog Man',
      subtitle: 'Sub',
      authors: ['Dav Pilkey'],
      isbn13: '9780545581608',
      pages: 240,
      release_year: 2016,
      series_name: 'Dog Man',
    });
    // numeric comes back as text, padded ("2.500000"): callers must Number() it.
    expect(Number(row.series_position)).toBe(2.5);
    expect(row.cached_at).toBeInstanceOf(Date);
  });

  it('keeps one row per source id: caching again returns the same id and refreshes the title', async () => {
    const book = bookWith();
    const first = track(await cacheHardcoverBook(db, book));
    const second = await cacheHardcoverBook(db, { ...book, title: 'Dog Man (Renamed)' });
    expect(second).toBe(first);
    expect((await rowFor(first)).title).toBe('Dog Man (Renamed)');
    const rows = await db.selectFrom('books').select('id').where('source_id', '=', book.sourceId).execute();
    expect(rows).toHaveLength(1);
  });

  it('does not let a thin copy erase what a richer one recorded', async () => {
    const book = bookWith();
    const id = track(await cacheHardcoverBook(db, { ...book, publisher: 'Graphix', binding: 'Paperback', isbn13: '9780545581608', coverUrl: 'https://x/c.jpg' }));
    // A search hit: no publisher, binding, ISBN or cover, and no known authors.
    await cacheHardcoverBook(db, { ...book, authors: [], pages: 111 });
    const row = await rowFor(id);
    expect(row).toMatchObject({
      publisher: 'Graphix',
      binding: 'Paperback',
      isbn13: '9780545581608',
      cover_url: 'https://x/c.jpg',
      authors: ['Dav Pilkey'],
      pages: 111, // new information still wins
    });
  });

  it('replaces the authors when the new copy has some', async () => {
    const book = bookWith();
    const id = track(await cacheHardcoverBook(db, book));
    await cacheHardcoverBook(db, { ...book, authors: ['A', 'B'] });
    expect((await rowFor(id)).authors).toEqual(['A', 'B']);
  });

  it('gives one row and one id when the same book is added at the same time', async () => {
    const book = bookWith();
    const ids = await Promise.all([1, 2, 3].map(() => cacheHardcoverBook(db, book)));
    ids.forEach(track);
    expect(new Set(ids).size).toBe(1);
    const rows = await db.selectFrom('books').select('id').where('source_id', '=', book.sourceId).execute();
    expect(rows).toHaveLength(1);
  });

  it('never merges manual books, even with the same title', async () => {
    const a = track(await addManualBook(db, { title: 'Homemade', authors: ['Me'] }));
    const b = track(await addManualBook(db, { title: 'Homemade', authors: ['Me'] }));
    expect(a).not.toBe(b);
    expect(await rowFor(a)).toMatchObject({ source: 'manual', source_id: null, title: 'Homemade', authors: ['Me'] });
  });
});
