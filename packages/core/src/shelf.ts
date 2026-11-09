import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { withTransaction, type Db } from './db';
import { DEFAULT_TIMEZONE } from './families';

export const SHELVES = ['to-read', 'currently-reading', 'read'] as const;
/** Goodreads' own `Exclusive Shelf` values, so the CSV export is a pass-through. */
export type Shelf = (typeof SHELVES)[number];

/** A book as we hold it. Unlike a search hit, it always has our id, and a hand-entered book has no source id. */
export interface StoredBook {
  id: string;
  sourceId: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  pages: number | null;
  releaseYear: number | null;
  coverUrl: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
  description: string | null;
  publisher: string | null;
  binding: string | null;
}

export interface ShelfEntry {
  id: string;
  profileId: string;
  shelf: Shelf;
  rating: number | null;
  review: string | null;
  /** `YYYY-MM-DD`, the calendar date as stored. */
  dateAdded: string;
  dateStarted: string | null;
  dateRead: string | null;
  readCount: number;
  currentPage: number | null;
  owned: boolean;
  tags: string[];
  book: StoredBook;
}

// A client-supplied id. Postgres raises on text that is not a uuid, which would
// read as a server error rather than "no such profile".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One query shape for every read, so an entry always comes back with its book. */
function entries(db: Db) {
  return db
    .selectFrom('shelf_entries as e')
    .innerJoin('books as b', 'b.id', 'e.book_id')
    .innerJoin('profiles as p', 'p.id', 'e.profile_id')
    .select([
      'e.id',
      'e.profile_id',
      'e.shelf',
      'e.rating',
      'e.review',
      'e.date_added',
      'e.date_started',
      'e.date_read',
      'e.read_count',
      'e.current_page',
      'e.owned',
      'e.tags',
      'b.id as book_id',
      'b.source_id',
      'b.title',
      'b.subtitle',
      'b.authors',
      'b.isbn13',
      'b.isbn10',
      'b.pages',
      'b.release_year',
      'b.cover_url',
      'b.series_name',
      'b.series_position',
      'b.description',
      'b.publisher',
      'b.binding',
    ]);
}

type EntryRow = Awaited<ReturnType<ReturnType<typeof entries>['executeTakeFirstOrThrow']>>;

const toEntry = (row: EntryRow): ShelfEntry => ({
  id: row.id,
  profileId: row.profile_id,
  shelf: row.shelf,
  rating: row.rating,
  review: row.review,
  dateAdded: row.date_added,
  dateStarted: row.date_started,
  dateRead: row.date_read,
  readCount: row.read_count,
  currentPage: row.current_page,
  owned: row.owned,
  tags: row.tags,
  book: {
    id: row.book_id,
    sourceId: row.source_id,
    title: row.title,
    subtitle: row.subtitle,
    authors: row.authors,
    isbn13: row.isbn13,
    isbn10: row.isbn10,
    pages: row.pages,
    releaseYear: row.release_year,
    coverUrl: row.cover_url,
    seriesName: row.series_name,
    // numeric comes back as text padded to the column's scale ("2.500000").
    seriesPosition: row.series_position === null ? null : Number(row.series_position),
    description: row.description,
    publisher: row.publisher,
    binding: row.binding,
  },
});

/**
 * Puts a book on a profile's shelf, or moves it if it is already on one (a
 * profile has one entry per book). Moving to "currently-reading" or "read"
 * stamps the start or finish date the first time, and never overwrites a date
 * someone has already set.
 *
 * Returns undefined when the profile is not in this family or the book does not
 * exist, so another family's profile is indistinguishable from a missing one.
 */
export async function addToShelf(
  db: Db,
  familyId: string,
  profileId: string,
  bookId: string,
  shelf: Shelf,
): Promise<ShelfEntry | undefined> {
  if (!UUID.test(profileId) || !UUID.test(bookId)) return undefined;
  return withTransaction(db, async (trx) => {
    const profile = await trx
      .selectFrom('profiles as p')
      .innerJoin('families as f', 'f.id', 'p.family_id')
      .select(['p.id', 'f.timezone'])
      .where('p.id', '=', profileId)
      .where('p.family_id', '=', familyId)
      .executeTakeFirst();
    // The family's calendar day, not the database's (UTC).
    const today = sql<string>`(now() at time zone ${profile?.timezone ?? DEFAULT_TIMEZONE})::date`;
    const book = await trx.selectFrom('books').select('id').where('id', '=', bookId).executeTakeFirst();
    if (!profile || !book) return undefined;

    const existing = await trx
      .selectFrom('shelf_entries')
      .select(['id', 'shelf'])
      .where('profile_id', '=', profileId)
      .where('book_id', '=', bookId)
      .executeTakeFirst();

    let id = existing?.id;
    if (!existing) {
      id = randomUUID();
      await trx
        .insertInto('shelf_entries')
        .values({
          id,
          profile_id: profileId,
          book_id: bookId,
          shelf,
          date_started: shelf === 'currently-reading' ? today : null,
          date_read: shelf === 'read' ? today : null,
          date_added: today,
        })
        .execute();
    } else if (existing.shelf !== shelf) {
      await trx
        .updateTable('shelf_entries')
        .set({
          shelf,
          updated_at: sql`now()`,
          ...(shelf === 'currently-reading' && { date_started: sql<string>`coalesce(date_started, ${today})` }),
          ...(shelf === 'read' && { date_read: sql<string>`coalesce(date_read, ${today})` }),
        })
        .where('id', '=', existing.id)
        .execute();
    }

    return toEntry(await entries(trx).where('e.id', '=', id!).executeTakeFirstOrThrow());
  });
}

/** A profile's entries, newest first, optionally one shelf. Empty for a profile outside this family. */
export async function listShelf(db: Db, familyId: string, profileId: string, shelf?: Shelf): Promise<ShelfEntry[]> {
  if (!UUID.test(profileId)) return [];
  let query = entries(db).where('e.profile_id', '=', profileId).where('p.family_id', '=', familyId);
  if (shelf) query = query.where('e.shelf', '=', shelf);
  const rows = await query.orderBy('e.updated_at', 'desc').orderBy('e.id').execute();
  return rows.map(toEntry);
}
