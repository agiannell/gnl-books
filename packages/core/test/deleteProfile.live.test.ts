import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { addManualBook } from '../src/books/cache';
import { createDb, type Db } from '../src/db';
import { getGoal, setGoal } from '../src/goals';
import { createProfile, deleteProfile, getProfile, LastProfileError, listProfiles } from '../src/profiles';
import { addToShelf, listShelf, logProgress, PROFILE_DELETE_BATCH } from '../src/shelf';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. Every row
// it makes is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('deleting a profile (live)', () => {
  let db: Db;
  const families: { familyId: string; sub: string }[] = [];
  const bookIds: string[] = [];

  const newFamily = async () => {
    const sub = `test-${randomUUID()}`;
    const family = await bootstrapFamily(db, { cognitoSub: sub, familyName: 'Test Family', parentName: 'Pat', pin: '4821' });
    families.push({ familyId: family.id, sub });
    const [parent] = await listProfiles(db, family.id);
    const kid = await createProfile(db, family.id, { name: 'Sam' });
    return { familyId: family.id, parentId: parent!.id, kidId: kid.id };
  };

  const newBook = async (title = 'Test Book') => {
    const id = await addManualBook(db, { title, authors: ['A'] });
    bookIds.push(id);
    return id;
  };

  const n = (row: { n: string }) => Number(row.n);
  const entryCount = async (profileId: string) =>
    n(await db.selectFrom('shelf_entries').select((eb) => eb.fn.countAll<string>().as('n')).where('profile_id', '=', profileId).executeTakeFirstOrThrow());
  const eventCount = async (entryId: string) =>
    n(await db.selectFrom('progress_events').select((eb) => eb.fn.countAll<string>().as('n')).where('shelf_entry_id', '=', entryId).executeTakeFirstOrThrow());
  const goalCount = async (profileId: string) =>
    n(await db.selectFrom('reading_goals').select((eb) => eb.fn.countAll<string>().as('n')).where('profile_id', '=', profileId).executeTakeFirstOrThrow());

  beforeAll(() => {
    db = createDb({ host: endpoint!, max: 6 });
  });

  afterAll(async () => {
    const ids = families.map((f) => f.familyId);
    if (ids.length) {
      const profiles = db.selectFrom('profiles').select('id').where('family_id', 'in', ids);
      const entryIds = db.selectFrom('shelf_entries').select('id').where('profile_id', 'in', profiles);
      // In batches: a test that fails midway can leave more events than one transaction may delete.
      for (;;) {
        const batch = await db.selectFrom('progress_events').select('id').where('shelf_entry_id', 'in', entryIds).limit(1000).execute();
        if (batch.length === 0) break;
        await db.deleteFrom('progress_events').where('id', 'in', batch.map((e) => e.id)).execute();
      }
      for (;;) {
        const batch = await db.selectFrom('shelf_entries').select('id').where('profile_id', 'in', profiles).limit(1000).execute();
        if (batch.length === 0) break;
        await db.deleteFrom('shelf_entries').where('id', 'in', batch.map((e) => e.id)).execute();
      }
      await db.deleteFrom('reading_goals').where('profile_id', 'in', profiles).execute();
      await db.deleteFrom('alexa_devices').where('family_id', 'in', ids).execute();
      await db.deleteFrom('accounts').where('family_id', 'in', ids).execute();
      await db.deleteFrom('profiles').where('family_id', 'in', ids).execute();
      await db.deleteFrom('families').where('id', 'in', ids).execute();
    }
    for (let i = 0; i < bookIds.length; i += 500) {
      await db.deleteFrom('books').where('id', 'in', bookIds.slice(i, i + 500)).execute();
    }
    await db.destroy();
  }, 300_000);

  it('deletes the profile with its shelf, logs and goals, and leaves everyone else’s', async () => {
    const f = await newFamily();
    const [b1, b2] = [await newBook(), await newBook('Other')];
    const mine = (await addToShelf(db, f.familyId, f.kidId, b1, 'currently-reading'))!;
    await addToShelf(db, f.familyId, f.kidId, b2, 'read');
    await logProgress(db, f.familyId, mine.id, { pagesRead: 10, source: 'web' });
    await setGoal(db, f.familyId, f.kidId, 2026, 12);
    const parentEntry = (await addToShelf(db, f.familyId, f.parentId, b1, 'currently-reading'))!;
    await logProgress(db, f.familyId, parentEntry.id, { pagesRead: 5, source: 'web' });
    await setGoal(db, f.familyId, f.parentId, 2026, 30);

    expect(await deleteProfile(db, f.familyId, f.kidId)).toBe(true);

    expect(await getProfile(db, f.familyId, f.kidId)).toBeUndefined();
    expect(await entryCount(f.kidId)).toBe(0);
    expect(await eventCount(mine.id)).toBe(0);
    expect(await goalCount(f.kidId)).toBe(0);
    // The other profile, its entry, log and goal are intact, and the books stay.
    expect((await listProfiles(db, f.familyId)).map((p) => p.id)).toEqual([f.parentId]);
    expect(await listShelf(db, f.familyId, f.parentId)).toHaveLength(1);
    expect(await eventCount(parentEntry.id)).toBe(1);
    expect((await getGoal(db, f.familyId, f.parentId, 2026))?.target).toBe(30);
    expect(await db.selectFrom('books').select('id').where('id', '=', b1).executeTakeFirst()).toBeDefined();
  });

  it('can delete a parent profile while another profile is left', async () => {
    const f = await newFamily();
    expect(await deleteProfile(db, f.familyId, f.parentId)).toBe(true);
    expect((await listProfiles(db, f.familyId)).map((p) => p.id)).toEqual([f.kidId]);
  });

  it('unassigns the profile’s Alexa devices instead of deleting them', async () => {
    const f = await newFamily();
    const deviceId = `test-device-${randomUUID()}`;
    await db.insertInto('alexa_devices').values({ device_id: deviceId, family_id: f.familyId, profile_id: f.kidId, label: 'Kitchen' }).execute();
    await deleteProfile(db, f.familyId, f.kidId);
    const device = await db.selectFrom('alexa_devices').selectAll().where('device_id', '=', deviceId).executeTakeFirst();
    expect(device).toMatchObject({ family_id: f.familyId, profile_id: null, label: 'Kitchen' });
  });

  // Past the batch size, and with a log past the event batch, so neither the
  // entries nor the events fit one transaction's 3,000-row limit.
  it('deletes a shelf of more than one batch of entries', async () => {
    const f = await newFamily();
    const total = PROFILE_DELETE_BATCH * 2 + 100;
    const books = Array.from({ length: total }, (_, i) => ({
      id: randomUUID(),
      source: 'manual' as const,
      source_id: null,
      title: `Test Book ${i}`,
      authors: JSON.stringify(['A']),
    }));
    const entries = books.map((b) => ({ id: randomUUID(), profile_id: f.kidId, book_id: b.id, shelf: 'to-read' as const }));
    bookIds.push(...books.map((b) => b.id));
    for (let i = 0; i < total; i += 250) {
      await db.insertInto('books').values(books.slice(i, i + 250)).execute();
      await db.insertInto('shelf_entries').values(entries.slice(i, i + 250)).execute();
    }
    const events = Array.from({ length: 1200 }, () => ({ id: randomUUID(), shelf_entry_id: entries[0]!.id, source: 'web' as const }));
    for (let i = 0; i < events.length; i += 400) await db.insertInto('progress_events').values(events.slice(i, i + 400)).execute();
    expect(await entryCount(f.kidId)).toBe(total);

    expect(await deleteProfile(db, f.familyId, f.kidId)).toBe(true);

    expect(await entryCount(f.kidId)).toBe(0);
    expect(await eventCount(entries[0]!.id)).toBe(0);
    expect(await getProfile(db, f.familyId, f.kidId)).toBeUndefined();
  }, 240_000);

  it('refuses to delete the last profile, and leaves its shelf alone', async () => {
    const f = await newFamily();
    await deleteProfile(db, f.familyId, f.kidId);
    const entry = (await addToShelf(db, f.familyId, f.parentId, await newBook(), 'to-read'))!;
    await expect(deleteProfile(db, f.familyId, f.parentId)).rejects.toBeInstanceOf(LastProfileError);
    expect(await getProfile(db, f.familyId, f.parentId)).toBeDefined();
    expect((await listShelf(db, f.familyId, f.parentId)).map((e) => e.id)).toEqual([entry.id]);
  });

  // Whether the two deletes overlap is down to timing, so many families race at
  // once. Without the write to the family row, both deletes of a pair commit
  // (write skew) and a family is left with no profile.
  it('lets only one of two simultaneous deletes of the last two profiles through', async () => {
    const races = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const f = await newFamily();
        const results = await Promise.allSettled([deleteProfile(db, f.familyId, f.parentId), deleteProfile(db, f.familyId, f.kidId)]);
        return { f, results };
      }),
    );
    for (const { f, results } of races) {
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(LastProfileError);
      expect(await listProfiles(db, f.familyId)).toHaveLength(1);
    }
  }, 120_000);

  it('is false for another family’s profile, a missing one, and a malformed id, deleting nothing', async () => {
    const mine = await newFamily();
    const theirs = await newFamily();
    const entry = (await addToShelf(db, theirs.familyId, theirs.kidId, await newBook(), 'to-read'))!;
    for (const id of [theirs.kidId, randomUUID(), 'abc', '', "x'; --"]) {
      expect(await deleteProfile(db, mine.familyId, id)).toBe(false);
    }
    expect(await getProfile(db, theirs.familyId, theirs.kidId)).toBeDefined();
    expect((await listShelf(db, theirs.familyId, theirs.kidId)).map((e) => e.id)).toEqual([entry.id]);
  });
});
