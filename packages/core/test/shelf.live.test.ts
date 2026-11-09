import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { addManualBook } from '../src/books/cache';
import { createDb, type Db } from '../src/db';
import { DEFAULT_TIMEZONE } from '../src/families';
import { createProfile } from '../src/profiles';
import {
  addToShelf,
  DateInFutureError,
  finishEntry,
  listShelf,
  logProgress,
  MAX_PAGE,
  ProgressRejectedError,
  rateEntry,
  reviewEntry,
} from '../src/shelf';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. Every row
// it makes is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('shelves (live)', () => {
  let db: Db;
  const families: { familyId: string; sub: string }[] = [];
  const bookIds: string[] = [];

  const newFamily = async () => {
    const sub = `test-${randomUUID()}`;
    const family = await bootstrapFamily(db, { cognitoSub: sub, familyName: 'Test Family', parentName: 'Pat', pin: '4821' });
    families.push({ familyId: family.id, sub });
    const kid = await createProfile(db, family.id, { name: 'Sam' });
    return { familyId: family.id, kidId: kid.id };
  };

  const newBook = async (title = 'Test Book', extra: { seriesPosition?: number } = {}) => {
    const id = await addManualBook(db, { title, authors: ['Test Author'], pages: 120, ...extra });
    bookIds.push(id);
    return id;
  };

  beforeAll(() => {
    db = createDb({ host: endpoint!, max: 4 });
  });

  afterAll(async () => {
    // Children first: the foreign keys are NO ACTION, not CASCADE. One statement
    // per table for all the test families (each statement is a slow round trip,
    // and there are dozens of families); a few dozen rows is far under the
    // 3,000-row transaction limit.
    const ids = families.map((f) => f.familyId);
    if (ids.length) {
      const profiles = db.selectFrom('profiles').select('id').where('family_id', 'in', ids);
      const entryIds = db.selectFrom('shelf_entries').select('id').where('profile_id', 'in', profiles);
      await db.deleteFrom('progress_events').where('shelf_entry_id', 'in', entryIds).execute();
      await db.deleteFrom('shelf_entries').where('profile_id', 'in', profiles).execute();
      await db.deleteFrom('accounts').where('family_id', 'in', ids).execute();
      await db.deleteFrom('profiles').where('family_id', 'in', ids).execute();
      await db.deleteFrom('families').where('id', 'in', ids).execute();
    }
    if (bookIds.length) await db.deleteFrom('books').where('id', 'in', bookIds).execute();
    await db.destroy();
  }, 120_000);

  const setZone = (familyId: string, zone: string) =>
    db.updateTable('families').set({ timezone: zone }).where('id', '=', familyId).execute();

  // The calendar date right now in a zone, computed by the database.
  const today = async (zone = DEFAULT_TIMEZONE) =>
    (await sql<{ d: string }>`select (now() at time zone ${zone})::date::text as d`.execute(db)).rows[0]!.d;

  it('puts a book on a shelf, with its book, and stamps the start date for currently-reading', async () => {
    const { familyId, kidId } = await newFamily();
    const bookId = await newBook('Dog Man', { seriesPosition: 2.5 });
    const entry = await addToShelf(db, familyId, kidId, bookId, 'currently-reading');
    expect(entry).toMatchObject({
      profileId: kidId,
      shelf: 'currently-reading',
      rating: null,
      readCount: 1,
      owned: false,
      tags: [],
      dateRead: null,
      book: { id: bookId, sourceId: null, title: 'Dog Man', authors: ['Test Author'], pages: 120, seriesPosition: 2.5 },
    });
    // No zone set, so the default (Central), as a plain calendar string.
    expect(entry!.dateStarted).toBe(await today());
    expect(entry!.dateAdded).toBe(await today());
  });

  it('stamps the finish date for read, and leaves the start date empty', async () => {
    const { familyId, kidId } = await newFamily();
    const entry = await addToShelf(db, familyId, kidId, await newBook(), 'read');
    expect(entry).toMatchObject({ shelf: 'read', dateStarted: null });
    expect(entry!.dateRead).toBe(await today());
  });

  // Kiritimati is UTC+14 and Pago Pago UTC-11: 25 hours apart, so at any moment
  // they are on different calendar days, and neither can be mistaken for UTC's.
  it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])('dates entries in the family’s own zone (%s)', async (zone) => {
    const { familyId, kidId } = await newFamily();
    await db.updateTable('families').set({ timezone: zone }).where('id', '=', familyId).execute();
    const entry = await addToShelf(db, familyId, kidId, await newBook(), 'read');
    expect(entry!.dateAdded).toBe(await today(zone));
    expect(entry!.dateRead).toBe(await today(zone));
  });

  it('puts the same instant on different days for families in different zones', async () => {
    const a = await newFamily();
    const b = await newFamily();
    await db.updateTable('families').set({ timezone: 'Pacific/Kiritimati' }).where('id', '=', a.familyId).execute();
    await db.updateTable('families').set({ timezone: 'Pacific/Pago_Pago' }).where('id', '=', b.familyId).execute();
    const [ea, eb] = [
      await addToShelf(db, a.familyId, a.kidId, await newBook(), 'read'),
      await addToShelf(db, b.familyId, b.kidId, await newBook(), 'read'),
    ];
    expect(ea!.dateRead).not.toBe(eb!.dateRead);
  });

  it('moves a book already on a shelf rather than adding a second entry', async () => {
    const { familyId, kidId } = await newFamily();
    const bookId = await newBook();
    const first = await addToShelf(db, familyId, kidId, bookId, 'to-read');
    const moved = await addToShelf(db, familyId, kidId, bookId, 'currently-reading');
    expect(moved!.id).toBe(first!.id);
    expect(moved).toMatchObject({ shelf: 'currently-reading', dateAdded: first!.dateAdded });
    expect(await listShelf(db, familyId, kidId)).toHaveLength(1);
  });

  it('never overwrites a date someone already set when moving', async () => {
    const { familyId, kidId } = await newFamily();
    const bookId = await newBook();
    const entry = await addToShelf(db, familyId, kidId, bookId, 'currently-reading');
    await db.updateTable('shelf_entries').set({ date_started: '2025-01-02' }).where('id', '=', entry!.id).execute();
    await addToShelf(db, familyId, kidId, bookId, 'read');
    await addToShelf(db, familyId, kidId, bookId, 'currently-reading');
    expect((await listShelf(db, familyId, kidId))[0]).toMatchObject({ dateStarted: '2025-01-02', shelf: 'currently-reading' });
  });

  it('is the same entry, unchanged, when the book is already on that shelf', async () => {
    const { familyId, kidId } = await newFamily();
    const bookId = await newBook();
    const a = await addToShelf(db, familyId, kidId, bookId, 'to-read');
    const b = await addToShelf(db, familyId, kidId, bookId, 'to-read');
    expect(b).toEqual(a);
  });

  it('keeps one entry when the same book is added twice at once', async () => {
    const { familyId, kidId } = await newFamily();
    const bookId = await newBook();
    const results = await Promise.all([
      addToShelf(db, familyId, kidId, bookId, 'to-read'),
      addToShelf(db, familyId, kidId, bookId, 'to-read'),
    ]);
    expect(results.every(Boolean)).toBe(true);
    expect(await listShelf(db, familyId, kidId)).toHaveLength(1);
  });

  it('lists a shelf, filtered or all, and only that profile’s', async () => {
    const { familyId, kidId } = await newFamily();
    const other = await createProfile(db, familyId, { name: 'Alex' });
    const [a, b] = [await newBook('A'), await newBook('B')];
    await addToShelf(db, familyId, kidId, a, 'to-read');
    await addToShelf(db, familyId, kidId, b, 'read');
    await addToShelf(db, familyId, other.id, a, 'read');
    expect((await listShelf(db, familyId, kidId)).map((e) => e.book.title).sort()).toEqual(['A', 'B']);
    expect((await listShelf(db, familyId, kidId, 'read')).map((e) => e.book.title)).toEqual(['B']);
    expect(await listShelf(db, familyId, kidId, 'currently-reading')).toEqual([]);
  });

  it('treats another family’s profile as missing, for writing and reading', async () => {
    const mine = await newFamily();
    const theirs = await newFamily();
    const bookId = await newBook();
    expect(await addToShelf(db, mine.familyId, theirs.kidId, bookId, 'read')).toBeUndefined();
    expect(await listShelf(db, theirs.familyId, theirs.kidId)).toEqual([]);

    await addToShelf(db, theirs.familyId, theirs.kidId, bookId, 'read');
    expect(await listShelf(db, mine.familyId, theirs.kidId)).toEqual([]);
  });

  it('is undefined for a book that does not exist', async () => {
    const { familyId, kidId } = await newFamily();
    expect(await addToShelf(db, familyId, kidId, randomUUID(), 'read')).toBeUndefined();
    expect(await listShelf(db, familyId, kidId)).toEqual([]);
  });

  describe('editing an entry', () => {
    const shelved = async (shelf: 'to-read' | 'currently-reading' | 'read' = 'currently-reading') => {
      const family = await newFamily();
      const entry = await addToShelf(db, family.familyId, family.kidId, await newBook(), shelf);
      return { ...family, entry: entry! };
    };
    it('rates, re-rates and clears', async () => {
      const { familyId, entry } = await shelved();
      expect((await rateEntry(db, familyId, entry.id, 4))!.rating).toBe(4);
      expect((await rateEntry(db, familyId, entry.id, 2))!.rating).toBe(2);
      expect((await rateEntry(db, familyId, entry.id, null))!.rating).toBeNull();
    });

    it('does not rate a book onto the wrong shelf or change anything else', async () => {
      const { familyId, entry } = await shelved('to-read');
      const rated = await rateEntry(db, familyId, entry.id, 5);
      expect(rated).toMatchObject({ shelf: 'to-read', dateRead: null, review: null });
    });

    it('writes and clears a review', async () => {
      const { familyId, entry } = await shelved();
      expect((await reviewEntry(db, familyId, entry.id, 'Loved it 🐶'))!.review).toBe('Loved it 🐶');
      expect((await reviewEntry(db, familyId, entry.id, null))!.review).toBeNull();
    });

    it('finishes a book: read shelf, finish date today in the family’s zone, start date kept', async () => {
      const { familyId, entry } = await shelved('currently-reading');
      const done = await finishEntry(db, familyId, entry.id);
      expect(done).toMatchObject({ shelf: 'read', dateStarted: entry.dateStarted, rating: null, readCount: 1 });
      expect(done!.dateRead).toBe(await today());
    });

    it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])('stamps the finish date in the family zone (%s)', async (zone) => {
      const { familyId, entry } = await shelved('to-read');
      await setZone(familyId, zone);
      expect((await finishEntry(db, familyId, entry.id))!.dateRead).toBe(await today(zone));
    });

    it('uses the date given, and a later finish without one keeps it', async () => {
      const { familyId, entry } = await shelved();
      expect((await finishEntry(db, familyId, entry.id, { dateRead: '2025-12-31' }))!.dateRead).toBe('2025-12-31');
      expect((await finishEntry(db, familyId, entry.id))!.dateRead).toBe('2025-12-31');
      expect((await finishEntry(db, familyId, entry.id, { dateRead: '2026-01-01' }))!.dateRead).toBe('2026-01-01');
    });

    it('sets the rating with the finish, and keeps the existing one when none is given', async () => {
      const { familyId, entry } = await shelved();
      expect((await finishEntry(db, familyId, entry.id, { rating: 5 }))!.rating).toBe(5);
      expect((await finishEntry(db, familyId, entry.id))!.rating).toBe(5);
    });

    it('refuses a finish date after the family’s today, and changes nothing', async () => {
      const { familyId, entry } = await shelved('currently-reading');
      // Kiritimati is always at least a calendar day ahead of Pago Pago.
      await setZone(familyId, 'Pacific/Pago_Pago');
      await expect(finishEntry(db, familyId, entry.id, { dateRead: await today('Pacific/Kiritimati'), rating: 3 })).rejects.toThrow(
        DateInFutureError,
      );
      expect((await listShelf(db, familyId, entry.profileId))[0]).toMatchObject({ shelf: 'currently-reading', dateRead: null, rating: null });
    });

    it('accepts a date that is today only because of the family’s zone', async () => {
      const { familyId, entry } = await shelved('currently-reading');
      await setZone(familyId, 'Pacific/Kiritimati');
      const date = await today('Pacific/Kiritimati');
      expect((await finishEntry(db, familyId, entry.id, { dateRead: date }))!.dateRead).toBe(date);
    });

    it('treats another family’s entry, and a malformed or unknown id, as missing, for every edit', async () => {
      const mine = await newFamily();
      const theirs = await shelved('currently-reading');
      for (const id of [theirs.entry.id, randomUUID(), 'abc', '', "x'; --"]) {
        expect(await rateEntry(db, mine.familyId, id, 5)).toBeUndefined();
        expect(await reviewEntry(db, mine.familyId, id, 'mine now')).toBeUndefined();
        expect(await finishEntry(db, mine.familyId, id)).toBeUndefined();
      }
      expect((await listShelf(db, theirs.familyId, theirs.entry.profileId))[0]).toMatchObject({
        shelf: 'currently-reading',
        rating: null,
        review: null,
        dateRead: null,
      });
    });
  });

  describe('logging progress', () => {
    const start = async (shelf: 'to-read' | 'currently-reading' | 'read' = 'currently-reading') => {
      const family = await newFamily();
      const bookId = await newBook(); // 120 pages
      const entry = await addToShelf(db, family.familyId, family.kidId, bookId, shelf);
      return { ...family, bookId, entry: entry! };
    };
    const events = (entryId: string) =>
      db.selectFrom('progress_events').select(['page', 'pages_read', 'source']).where('shelf_entry_id', '=', entryId).orderBy('at').execute();
    const current = async (f: { familyId: string; kidId: string }) => (await listShelf(db, f.familyId, f.kidId))[0]!;

    it('adds pages read to the current page and logs each one', async () => {
      const s = await start();
      expect((await logProgress(db, s.familyId, s.entry.id, { pagesRead: 20, source: 'alexa' }))!.currentPage).toBe(20);
      expect((await logProgress(db, s.familyId, s.entry.id, { pagesRead: 30, source: 'web' }))!.currentPage).toBe(50);
      expect(await events(s.entry.id)).toEqual([
        { page: 20, pages_read: 20, source: 'alexa' },
        { page: 50, pages_read: 30, source: 'web' },
      ]);
    });

    it('takes a page, logs how far it moved, and logs zero for a correction backwards', async () => {
      const s = await start();
      await logProgress(db, s.familyId, s.entry.id, { page: 40, source: 'web' });
      await logProgress(db, s.familyId, s.entry.id, { page: 100, source: 'web' });
      const back = await logProgress(db, s.familyId, s.entry.id, { page: 80, source: 'web' });
      expect(back!.currentPage).toBe(80);
      expect((await events(s.entry.id)).map((e) => [e.page, e.pages_read])).toEqual([[40, 40], [100, 60], [80, 0]]);
    });

    it('starts a to-read book, stamping the start date in the family zone', async () => {
      const s = await start('to-read');
      await setZone(s.familyId, 'Pacific/Kiritimati');
      const entry = await logProgress(db, s.familyId, s.entry.id, { pagesRead: 5, source: 'widget' });
      expect(entry).toMatchObject({ shelf: 'currently-reading', currentPage: 5, dateStarted: await today('Pacific/Kiritimati') });
    });

    it('keeps a start date that is already set', async () => {
      const s = await start();
      await db.updateTable('shelf_entries').set({ date_started: '2025-01-02' }).where('id', '=', s.entry.id).execute();
      expect((await logProgress(db, s.familyId, s.entry.id, { pagesRead: 5, source: 'web' }))!.dateStarted).toBe('2025-01-02');
    });

    it('refuses to go past the last page, logging and changing nothing', async () => {
      const s = await start();
      await logProgress(db, s.familyId, s.entry.id, { page: 100, source: 'web' });
      await expect(logProgress(db, s.familyId, s.entry.id, { page: 121, source: 'web' })).rejects.toThrow(ProgressRejectedError);
      await expect(logProgress(db, s.familyId, s.entry.id, { pagesRead: 21, source: 'web' })).rejects.toThrow(/120 pages/);
      expect((await current(s)).currentPage).toBe(100);
      expect(await events(s.entry.id)).toHaveLength(1);
      expect((await logProgress(db, s.familyId, s.entry.id, { page: 120, source: 'web' }))!.currentPage).toBe(120);
    });

    it('caps a book with no page count at MAX_PAGE', async () => {
      const s = await start();
      await db.updateTable('books').set({ pages: null }).where('id', '=', s.bookId).execute();
      await expect(logProgress(db, s.familyId, s.entry.id, { page: MAX_PAGE + 1, source: 'web' })).rejects.toThrow(
        ProgressRejectedError,
      );
      expect((await logProgress(db, s.familyId, s.entry.id, { page: MAX_PAGE, source: 'web' }))!.currentPage).toBe(MAX_PAGE);
    });

    it('refuses a finished book, logging and changing nothing', async () => {
      const s = await start('read');
      await expect(logProgress(db, s.familyId, s.entry.id, { pagesRead: 10, source: 'web' })).rejects.toThrow(/already finished/);
      expect(await events(s.entry.id)).toEqual([]);
      expect(await current(s)).toMatchObject({ shelf: 'read', currentPage: null });
    });

    it('counts two simultaneous logs both, as a conflict retried', async () => {
      const s = await start();
      await Promise.all([
        logProgress(db, s.familyId, s.entry.id, { pagesRead: 10, source: 'web' }),
        logProgress(db, s.familyId, s.entry.id, { pagesRead: 10, source: 'alexa' }),
      ]);
      expect((await current(s)).currentPage).toBe(20);
      expect(await events(s.entry.id)).toHaveLength(2);
    });

    it('treats another family’s entry and a bad id as missing, logging nothing', async () => {
      const mine = await newFamily();
      const theirs = await start();
      for (const id of [theirs.entry.id, randomUUID(), 'abc', '']) {
        expect(await logProgress(db, mine.familyId, id, { pagesRead: 5, source: 'web' })).toBeUndefined();
      }
      expect(await events(theirs.entry.id)).toEqual([]);
      expect((await current(theirs)).currentPage).toBeNull();
    });
  });

  it.each(['', 'abc', "x'; drop table books; --"])('is undefined, not a server error, for the malformed id %j', async (bad) => {
    const { familyId, kidId } = await newFamily();
    const bookId = await newBook();
    expect(await addToShelf(db, familyId, bad, bookId, 'read')).toBeUndefined();
    expect(await addToShelf(db, familyId, kidId, bad, 'read')).toBeUndefined();
    expect(await listShelf(db, familyId, bad)).toEqual([]);
  });
});
