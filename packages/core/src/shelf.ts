import { randomUUID } from 'node:crypto';
import { sql, type RawBuilder } from 'kysely';
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
 * Today's calendar date in the family's zone, as a SQL expression. The database
 * clock is UTC, so `current_date` would date an evening finish tomorrow. Every
 * date the app stamps must come through here.
 */
export const localToday = (timezone: string | null) =>
  sql<string>`(now() at time zone ${timezone ?? DEFAULT_TIMEZONE})::date`;

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
    const today = localToday(profile?.timezone ?? null);
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

export class DateInFutureError extends Error {
  constructor() {
    super('A book cannot be finished on a day that has not happened yet');
    this.name = 'DateInFutureError';
  }
}

/** The columns the edit operations change; a date may be a SQL expression. */
interface EntryChanges {
  shelf?: Shelf;
  rating?: number | null;
  review?: string | null;
  current_page?: number | null;
  date_started?: string | RawBuilder<string>;
  date_read?: string | RawBuilder<string>;
}

/** What an edit gets to see of the entry it is changing, read in the same transaction. */
interface EntryState {
  timezone: string | null;
  shelf: Shelf;
  currentPage: number | null;
  /** The book's page count, when known. */
  bookPages: number | null;
}

/**
 * Loads an entry only if it belongs to this family, applies the changes `edit`
 * returns, and returns the entry as it now is. An entry id comes from a client,
 * so another family's entry is the same as a missing one (undefined).
 */
async function editEntry(
  db: Db,
  familyId: string,
  entryId: string,
  edit: (trx: Db, state: EntryState) => Promise<EntryChanges>,
): Promise<ShelfEntry | undefined> {
  if (!UUID.test(entryId)) return undefined;
  return withTransaction(db, async (trx) => {
    const owned = await trx
      .selectFrom('shelf_entries as e')
      .innerJoin('profiles as p', 'p.id', 'e.profile_id')
      .innerJoin('families as f', 'f.id', 'p.family_id')
      .innerJoin('books as b', 'b.id', 'e.book_id')
      .select(['f.timezone', 'e.shelf', 'e.current_page', 'b.pages'])
      .where('e.id', '=', entryId)
      .where('p.family_id', '=', familyId)
      .executeTakeFirst();
    if (!owned) return undefined;

    const changes = await edit(trx, {
      timezone: owned.timezone,
      shelf: owned.shelf,
      currentPage: owned.current_page,
      bookPages: owned.pages,
    });
    await trx
      .updateTable('shelf_entries')
      .set({ ...changes, updated_at: sql`now()` })
      .where('id', '=', entryId)
      .execute();
    return toEntry(await entries(trx).where('e.id', '=', entryId).executeTakeFirstOrThrow());
  });
}

/** Sets the rating (1 to 5), or clears it with null. The caller validates the range. */
export const rateEntry = (db: Db, familyId: string, entryId: string, rating: number | null) =>
  editEntry(db, familyId, entryId, async () => ({ rating }));

/** Sets the review, or clears it with null. */
export const reviewEntry = (db: Db, familyId: string, entryId: string, review: string | null) =>
  editEntry(db, familyId, entryId, async () => ({ review }));

/**
 * Moves the entry to "read". The finish date is the one given, else the one
 * already recorded, else today in the family's zone. A rating, if given, is set;
 * otherwise the existing one stays. Throws DateInFutureError for a later date
 * than the family's today. Dates before the book was added are fine: logging a
 * book read last year is normal.
 */
export const finishEntry = (
  db: Db,
  familyId: string,
  entryId: string,
  options: { dateRead?: string | undefined; rating?: number | undefined } = {},
) =>
  editEntry(db, familyId, entryId, async (trx, { timezone }) => {
    const today = localToday(timezone);
    if (options.dateRead !== undefined) {
      const { rows } = await sql<{ later: boolean }>`select ${options.dateRead}::date > ${today} as later`.execute(trx);
      if (rows[0]!.later) throw new DateInFutureError();
    }
    return {
      shelf: 'read',
      date_read: options.dateRead ?? sql<string>`coalesce(date_read, ${today})`,
      ...(options.rating !== undefined && { rating: options.rating }),
    };
  });

/** The furthest page that can be logged, so a typo cannot overflow the integer column. */
export const MAX_PAGE = 100_000;

export type ProgressSource = 'web' | 'alexa' | 'widget';

/** Where the reader says they are: on a page, or that they read some pages. Exactly one. */
export type ProgressInput = ({ page: number } | { pagesRead: number }) & { source: ProgressSource };

/** The entry's state makes this update impossible (a finished book, or past the last page). */
export class ProgressRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressRejectedError';
  }
}

/**
 * Records reading progress: appends to the progress log and moves the entry's
 * current page. Logging on a to-read book starts it (moves it to
 * currently-reading, stamping the start date once). A finished book refuses:
 * re-reading is not designed yet, and "I read 20 pages" about a finished book is
 * more likely a mistake than a re-read.
 *
 * With `page`, the logged `pages_read` is how far that moved forward (zero when
 * it moved back, a correction). With `pagesRead`, the new page is the current
 * one plus that. The caller validates the numbers' ranges.
 */
export async function logProgress(db: Db, familyId: string, entryId: string, input: ProgressInput) {
  // Made once, outside the transaction: a retried attempt must reuse the id.
  const eventId = randomUUID();
  return editEntry(db, familyId, entryId, async (trx, state) => {
    if (state.shelf === 'read') throw new ProgressRejectedError('This book is already finished');
    const before = state.currentPage ?? 0;
    const page = 'page' in input ? input.page : before + input.pagesRead;
    const limit = state.bookPages ?? MAX_PAGE;
    if (page > Math.min(limit, MAX_PAGE)) {
      throw new ProgressRejectedError(
        state.bookPages === null ? 'That is past the last page this app can log' : `This book has ${state.bookPages} pages`,
      );
    }
    const pagesRead = 'pagesRead' in input ? input.pagesRead : Math.max(0, page - before);

    await trx
      .insertInto('progress_events')
      .values({ id: eventId, shelf_entry_id: entryId, page, pages_read: pagesRead, source: input.source })
      .execute();
    return {
      current_page: page,
      shelf: 'currently-reading',
      date_started: sql<string>`coalesce(date_started, ${localToday(state.timezone)})`,
    };
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
