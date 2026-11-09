import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { addManualBook } from '../src/books/cache';
import { exportGoodreadsCsv } from '../src/csv';
import { createDb, type Db } from '../src/db';
import { createProfile } from '../src/profiles';
import { addToShelf, finishEntry, rateEntry, reviewEntry } from '../src/shelf';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. Every row
// it makes is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('Goodreads CSV export (live)', () => {
  let db: Db;
  const families: string[] = [];
  const bookIds: string[] = [];

  const newFamily = async () => {
    const family = await bootstrapFamily(db, {
      cognitoSub: `test-${randomUUID()}`,
      familyName: 'Test Family',
      parentName: 'Pat',
      pin: '4821',
    });
    families.push(family.id);
    const kid = await createProfile(db, family.id, { name: 'Sam' });
    return { familyId: family.id, kidId: kid.id };
  };

  beforeAll(() => {
    db = createDb({ host: endpoint!, max: 4 });
  });

  afterAll(async () => {
    // Children first. One statement per table for all the test families.
    if (families.length) {
      const profiles = db.selectFrom('profiles').select('id').where('family_id', 'in', families);
      await db.deleteFrom('shelf_entries').where('profile_id', 'in', profiles).execute();
      await db.deleteFrom('accounts').where('family_id', 'in', families).execute();
      await db.deleteFrom('profiles').where('family_id', 'in', families).execute();
      await db.deleteFrom('families').where('id', 'in', families).execute();
    }
    if (bookIds.length) await db.deleteFrom('books').where('id', 'in', bookIds).execute();
    await db.destroy();
  }, 120_000);

  it('exports what is really stored: dates from date columns, quoting, and the shelf in both columns', async () => {
    const { familyId, kidId } = await newFamily();
    const bookId = await addManualBook(db, {
      title: 'Test Book, "Quoted"',
      authors: ['Ann Lee', 'Bo Chan'],
      pages: 80,
      isbn13: '9780306406157',
    });
    const toReadId = await addManualBook(db, { title: 'Test Book Two', authors: ['A'] });
    bookIds.push(bookId, toReadId);
    const done = (await addToShelf(db, familyId, kidId, bookId, 'to-read'))!;
    await rateEntry(db, familyId, done.id, 5);
    await reviewEntry(db, familyId, done.id, 'Great,\nreally "great"');
    await finishEntry(db, familyId, done.id, { dateRead: '2026-01-15' });
    await addToShelf(db, familyId, kidId, toReadId, 'to-read');

    const csv = (await exportGoodreadsCsv(db, familyId, kidId))!;
    const lines = csv.split('\n');
    expect(lines[0]).toMatch(/^Book Id,Title,Author,/);
    expect(csv).toContain('"Test Book, ""Quoted"""');
    expect(csv).toContain('"Great,\nreally ""great"""');
    expect(csv).toMatch(/,2026\/01\/15,\d{4}\/\d{2}\/\d{2},read,/);
    expect(csv).toContain(',Ann Lee,"Lee, Ann",Bo Chan,');
    expect(csv).toContain('9780306406157');
    // The unfinished book: shelf in both columns, unrated, no read date.
    const unfinished = lines.find((l) => l.includes('Test Book Two'))!;
    expect(unfinished).toMatch(/^,Test Book Two,A,A,,,,0,.*,,\d{4}\/\d{2}\/\d{2},to-read,,to-read,/);
  });

  it('is just the header for a profile with an empty shelf', async () => {
    const { familyId, kidId } = await newFamily();
    const csv = (await exportGoodreadsCsv(db, familyId, kidId))!;
    expect(csv.trimEnd().split('\n')).toHaveLength(1);
  });

  it('is undefined for a profile in another family, a missing one, and a malformed id', async () => {
    const a = await newFamily();
    const b = await newFamily();
    expect(await exportGoodreadsCsv(db, b.familyId, a.kidId)).toBeUndefined();
    expect(await exportGoodreadsCsv(db, a.familyId, randomUUID())).toBeUndefined();
    expect(await exportGoodreadsCsv(db, a.familyId, 'nope')).toBeUndefined();
  });
});
