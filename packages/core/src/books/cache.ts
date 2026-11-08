import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { withTransaction, type Db } from '../db';
import type { BookSearchResult } from './types';

// Every book the family touches is copied into our own `books` table, so the
// library keeps working if Hardcover is down or its token has expired, and the
// daily request quota stops mattering after a book's first use.

// Keeps what we already have when the new copy lacks it. A search hit has no
// publisher or binding, and must not erase what a detail fetch recorded.
// Typed `any`: it is a raw SQL fragment, and Kysely checks column value types per column.
const keepOld = (column: string) => sql<any>`coalesce(excluded.${sql.ref(column)}, books.${sql.ref(column)})`;

/**
 * Inserts the book, or refreshes the existing row for the same source id, and
 * returns our id for it. One statement, so it is safe if two people add the
 * same book at once; `withTransaction` retries a write conflict.
 */
export async function cacheHardcoverBook(db: Db, book: BookSearchResult): Promise<string> {
  const row = await withTransaction(db, (trx) =>
    trx
      .insertInto('books')
      .values({
        id: randomUUID(),
        source: 'hardcover',
        source_id: book.sourceId,
        title: book.title,
        subtitle: book.subtitle ?? null,
        // jsonb is written as text; pg would send a JS array as a Postgres array.
        authors: JSON.stringify(book.authors),
        isbn13: book.isbn13 ?? null,
        isbn10: book.isbn10 ?? null,
        pages: book.pages ?? null,
        publisher: book.publisher ?? null,
        binding: book.binding ?? null,
        release_year: book.releaseYear ?? null,
        cover_url: book.coverUrl ?? null,
        series_name: book.seriesName ?? null,
        series_position: book.seriesPosition ?? null,
        description: book.description ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['source', 'source_id']).doUpdateSet({
          title: (eb) => eb.ref('excluded.title'),
          subtitle: keepOld('subtitle'),
          // An empty list from a source that did not know the authors keeps the old ones.
          authors: sql`case when excluded.authors = '[]'::jsonb then books.authors else excluded.authors end`,
          isbn13: keepOld('isbn13'),
          isbn10: keepOld('isbn10'),
          pages: keepOld('pages'),
          publisher: keepOld('publisher'),
          binding: keepOld('binding'),
          release_year: keepOld('release_year'),
          cover_url: keepOld('cover_url'),
          series_name: keepOld('series_name'),
          series_position: keepOld('series_position'),
          description: keepOld('description'),
          cached_at: sql`now()`,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

/** A book the catalog could not find, entered by hand. It has no source id, so it is never merged with another. */
export async function addManualBook(db: Db, book: Omit<BookSearchResult, 'sourceId'>): Promise<string> {
  const id = randomUUID();
  await withTransaction(db, (trx) =>
    trx
      .insertInto('books')
      .values({
        id,
        source: 'manual',
        source_id: null,
        title: book.title,
        subtitle: book.subtitle ?? null,
        authors: JSON.stringify(book.authors),
        isbn13: book.isbn13 ?? null,
        isbn10: book.isbn10 ?? null,
        pages: book.pages ?? null,
        publisher: book.publisher ?? null,
        binding: book.binding ?? null,
        release_year: book.releaseYear ?? null,
        cover_url: book.coverUrl ?? null,
        series_name: book.seriesName ?? null,
        series_position: book.seriesPosition ?? null,
        description: book.description ?? null,
      })
      .execute(),
  );
  return id;
}
