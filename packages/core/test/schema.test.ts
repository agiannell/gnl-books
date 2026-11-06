import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DB } from '../src';

// These are compile-time checks: `yarn typecheck` fails if a `@ts-expect-error`
// stops being an error, or a valid query stops compiling. Nothing here runs a
// query, so the builders are only constructed inside a function never called.
declare const db: Kysely<DB>;

function typeChecks() {
  // A complete valid insert. Generated columns (defaults) and nullable ones may be omitted.
  db.insertInto('shelf_entries').values({
    id: 'a',
    profile_id: 'b',
    book_id: 'c',
    shelf: 'currently-reading',
  });

  // jsonb columns are written as JSON text and read back as parsed arrays.
  db.insertInto('books').values({ id: 'a', source: 'manual', title: 'T', authors: JSON.stringify(['A']) });
  db.selectFrom('books').select('authors').executeTakeFirstOrThrow().then((row) => row.authors.map((a) => a.toUpperCase()));

  // date columns are plain strings, matching `typeParsers`.
  db.selectFrom('shelf_entries').select('date_added').executeTakeFirstOrThrow().then((row) => row.date_added.slice(0, 4));

  // @ts-expect-error not a Goodreads Exclusive Shelf value
  db.insertInto('shelf_entries').values({ id: 'a', profile_id: 'b', book_id: 'c', shelf: 'finished' });

  // @ts-expect-error pg would send a JS array as a Postgres array, which jsonb rejects
  db.insertInto('books').values({ id: 'a', source: 'manual', title: 'T', authors: ['A'] });

  // @ts-expect-error not a source the schema allows
  db.insertInto('progress_events').values({ id: 'a', shelf_entry_id: 'b', source: 'sms' });

  // @ts-expect-error no such table
  db.selectFrom('sys.jobs');
}

describe('generated schema types', () => {
  it('are checked by tsc, see the @ts-expect-error lines', () => {
    expect(typeChecks).toBeTypeOf('function');
  });
});
