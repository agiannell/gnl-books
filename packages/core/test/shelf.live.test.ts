import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { addManualBook } from '../src/books/cache';
import { createDb, type Db } from '../src/db';
import { DEFAULT_TIMEZONE } from '../src/families';
import { createProfile } from '../src/profiles';
import { addToShelf, DateInFutureError, finishEntry, listShelf, rateEntry, reviewEntry } from '../src/shelf';

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
    // Children first: the foreign keys are NO ACTION, not CASCADE.
    for (const { familyId, sub } of families) {
      const profiles = db.selectFrom('profiles').select('id').where('family_id', '=', familyId);
      await db.deleteFrom('shelf_entries').where('profile_id', 'in', profiles).execute();
      await db.deleteFrom('accounts').where('cognito_sub', '=', sub).execute();
      await db.deleteFrom('profiles').where('family_id', '=', familyId).execute();
      await db.deleteFrom('families').where('id', '=', familyId).execute();
    }
    if (bookIds.length) await db.deleteFrom('books').where('id', 'in', bookIds).execute();
    await db.destroy();
    // Each family takes four statements to remove, and there are dozens.
  }, 120_000);

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
    const setZone = (familyId: string, zone: string) =>
      db.updateTable('families').set({ timezone: zone }).where('id', '=', familyId).execute();

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

  it.each(['', 'abc', "x'; drop table books; --"])('is undefined, not a server error, for the malformed id %j', async (bad) => {
    const { familyId, kidId } = await newFamily();
    const bookId = await newBook();
    expect(await addToShelf(db, familyId, bad, bookId, 'read')).toBeUndefined();
    expect(await addToShelf(db, familyId, kidId, bad, 'read')).toBeUndefined();
    expect(await listShelf(db, familyId, bad)).toEqual([]);
  });
});
