import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { addManualBook } from '../src/books/cache';
import { createDb, type Db } from '../src/db';
import { getGoal, removeGoal, setGoal } from '../src/goals';
import { createProfile } from '../src/profiles';
import { addToShelf, type Shelf } from '../src/shelf';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. Every row
// it makes is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('reading goals (live)', () => {
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

  /** A book on the shelf, with its finish date set directly (null for none). */
  const shelve = async (f: { familyId: string; kidId: string }, shelf: Shelf, dateRead: string | null = null) => {
    const bookId = await addManualBook(db, { title: 'Test Book', authors: ['A'] });
    bookIds.push(bookId);
    const entry = (await addToShelf(db, f.familyId, f.kidId, bookId, shelf))!;
    await db.updateTable('shelf_entries').set({ date_read: dateRead }).where('id', '=', entry.id).execute();
  };

  beforeAll(() => {
    db = createDb({ host: endpoint!, max: 4 });
  });

  afterAll(async () => {
    // Children first. One statement per table for all the test families.
    const ids = families.map((f) => f.familyId);
    if (ids.length) {
      const profiles = db.selectFrom('profiles').select('id').where('family_id', 'in', ids);
      await db.deleteFrom('reading_goals').where('profile_id', 'in', profiles).execute();
      await db.deleteFrom('shelf_entries').where('profile_id', 'in', profiles).execute();
      await db.deleteFrom('accounts').where('family_id', 'in', ids).execute();
      await db.deleteFrom('profiles').where('family_id', 'in', ids).execute();
      await db.deleteFrom('families').where('id', 'in', ids).execute();
    }
    if (bookIds.length) await db.deleteFrom('books').where('id', 'in', bookIds).execute();
    await db.destroy();
  }, 120_000);

  it('removes one year’s goal and leaves the others', async () => {
    const { familyId, kidId } = await newFamily();
    await setGoal(db, familyId, kidId, 2026, 30);
    await setGoal(db, familyId, kidId, 2025, 10);
    expect(await removeGoal(db, familyId, kidId, 2026)).toBe(true);
    expect(await getGoal(db, familyId, kidId, 2026)).toBeUndefined();
    expect((await getGoal(db, familyId, kidId, 2025))?.target).toBe(10);
    expect(await removeGoal(db, familyId, kidId, 2026)).toBe(false);
  });

  it('removes no goal for another family’s profile or a bad id', async () => {
    const mine = await newFamily();
    const theirs = await newFamily();
    await setGoal(db, theirs.familyId, theirs.kidId, 2026, 30);
    expect(await removeGoal(db, mine.familyId, theirs.kidId, 2026)).toBe(false);
    expect(await removeGoal(db, mine.familyId, 'nope', 2026)).toBe(false);
    expect((await getGoal(db, theirs.familyId, theirs.kidId, 2026))?.target).toBe(30);
  });

  it('sets a goal, with nothing read yet', async () => {
    const { familyId, kidId } = await newFamily();
    expect(await setGoal(db, familyId, kidId, 2026, 30)).toEqual({ profileId: kidId, year: 2026, target: 30, booksRead: 0 });
    expect(await getGoal(db, familyId, kidId, 2026)).toEqual({ profileId: kidId, year: 2026, target: 30, booksRead: 0 });
  });

  it('replaces the target for the same year and keeps other years separate', async () => {
    const { familyId, kidId } = await newFamily();
    await setGoal(db, familyId, kidId, 2026, 30);
    await setGoal(db, familyId, kidId, 2025, 10);
    expect((await setGoal(db, familyId, kidId, 2026, 50))!.target).toBe(50);
    expect((await getGoal(db, familyId, kidId, 2026))!.target).toBe(50);
    expect((await getGoal(db, familyId, kidId, 2025))!.target).toBe(10);
    const rows = await db.selectFrom('reading_goals').select('year').where('profile_id', '=', kidId).execute();
    expect(rows).toHaveLength(2);
  });

  it('counts only read books finished in that year', async () => {
    const f = await newFamily();
    await shelve(f, 'read', '2025-12-31'); // last day of 2025: 2025 only
    await shelve(f, 'read', '2026-01-01'); // first day of 2026: 2026 only
    await shelve(f, 'read', '2026-12-31'); // last day of 2026
    await shelve(f, 'read', '2027-01-01'); // next year: neither
    await shelve(f, 'read', null); // read with no date: no year
    await shelve(f, 'currently-reading', '2026-06-01'); // not on the read shelf, whatever its date
    await shelve(f, 'to-read');
    await setGoal(db, f.familyId, f.kidId, 2025, 5);
    await setGoal(db, f.familyId, f.kidId, 2026, 5);
    expect((await getGoal(db, f.familyId, f.kidId, 2025))!.booksRead).toBe(1);
    expect((await getGoal(db, f.familyId, f.kidId, 2026))!.booksRead).toBe(2);
    // setGoal reports the same count.
    expect((await setGoal(db, f.familyId, f.kidId, 2026, 6))!.booksRead).toBe(2);
  });

  it('counts only that profile’s books', async () => {
    const f = await newFamily();
    const other = await createProfile(db, f.familyId, { name: 'Alex' });
    await shelve(f, 'read', '2026-03-03');
    await shelve({ familyId: f.familyId, kidId: other.id }, 'read', '2026-03-03');
    await setGoal(db, f.familyId, f.kidId, 2026, 5);
    expect((await getGoal(db, f.familyId, f.kidId, 2026))!.booksRead).toBe(1);
  });

  it('is undefined when no goal is set for the year', async () => {
    const { familyId, kidId } = await newFamily();
    await setGoal(db, familyId, kidId, 2026, 30);
    expect(await getGoal(db, familyId, kidId, 2024)).toBeUndefined();
  });

  it('defaults to the current year in the family’s zone', async () => {
    const { familyId, kidId } = await newFamily();
    await db.updateTable('families').set({ timezone: 'Pacific/Pago_Pago' }).where('id', '=', familyId).execute();
    const year = (await sql<{ y: number }>`select extract(year from now() at time zone 'Pacific/Pago_Pago')::int as y`.execute(db)).rows[0]!.y;
    await setGoal(db, familyId, kidId, year, 12);
    expect(await getGoal(db, familyId, kidId)).toMatchObject({ year, target: 12 });
  });

  it('treats another family’s profile and a malformed or unknown id as missing, for both calls', async () => {
    const mine = await newFamily();
    const theirs = await newFamily();
    await setGoal(db, theirs.familyId, theirs.kidId, 2026, 30);
    for (const id of [theirs.kidId, randomUUID(), 'abc', '', "x'; --"]) {
      expect(await setGoal(db, mine.familyId, id, 2026, 99)).toBeUndefined();
      expect(await getGoal(db, mine.familyId, id, 2026)).toBeUndefined();
    }
    // Their goal is untouched.
    expect((await getGoal(db, theirs.familyId, theirs.kidId, 2026))!.target).toBe(30);
  });

  it('keeps one row when the same goal is set twice at once', async () => {
    const { familyId, kidId } = await newFamily();
    await Promise.all([setGoal(db, familyId, kidId, 2026, 10), setGoal(db, familyId, kidId, 2026, 20)]);
    const rows = await db.selectFrom('reading_goals').select('target').where('profile_id', '=', kidId).execute();
    expect(rows).toHaveLength(1);
    expect([10, 20]).toContain(rows[0]!.target);
  });
});
