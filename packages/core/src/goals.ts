import { sql } from 'kysely';
import { withTransaction, type Db } from './db';
import { isUuid } from './ids';
import { localToday } from './shelf';

export interface ReadingGoal {
  profileId: string;
  year: number;
  target: number;
  /** Books on the read shelf with a finish date in that year. */
  booksRead: number;
}

export const MIN_GOAL_YEAR = 2000;
export const MAX_GOAL_YEAR = 2100;
export const MAX_GOAL_TARGET = 1000;

/** Books finished in a calendar year. A read entry with no finish date (an import may lack one) counts for no year. */
async function booksRead(db: Db, profileId: string, year: number): Promise<number> {
  const { n } = await db
    .selectFrom('shelf_entries')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('profile_id', '=', profileId)
    .where('shelf', '=', 'read')
    .where('date_read', '>=', `${year}-01-01`)
    .where('date_read', '<=', `${year}-12-31`)
    .executeTakeFirstOrThrow();
  return Number(n);
}

/** The profile's family's zone, only if the profile is in this family. */
async function familyZone(db: Db, familyId: string, profileId: string) {
  if (!isUuid(profileId)) return undefined;
  return db
    .selectFrom('profiles as p')
    .innerJoin('families as f', 'f.id', 'p.family_id')
    .select('f.timezone')
    .where('p.id', '=', profileId)
    .where('p.family_id', '=', familyId)
    .executeTakeFirst();
}

/**
 * Sets the profile's target for a year, replacing any earlier one. Returns
 * undefined when the profile is not in this family. The caller validates the
 * year and target ranges.
 */
export async function setGoal(
  db: Db,
  familyId: string,
  profileId: string,
  year: number,
  target: number,
): Promise<ReadingGoal | undefined> {
  return withTransaction(db, async (trx) => {
    if (!(await familyZone(trx, familyId, profileId))) return undefined;
    await trx
      .insertInto('reading_goals')
      .values({ profile_id: profileId, year, target })
      .onConflict((oc) => oc.columns(['profile_id', 'year']).doUpdateSet({ target }))
      .execute();
    return { profileId, year, target, booksRead: await booksRead(trx, profileId, year) };
  });
}

/**
 * The profile's goal for a year (default: the current year in the family's
 * zone), or undefined when none is set or the profile is not in this family.
 */
export async function getGoal(db: Db, familyId: string, profileId: string, year?: number): Promise<ReadingGoal | undefined> {
  const zone = await familyZone(db, familyId, profileId);
  if (!zone) return undefined;
  const goalYear =
    year ??
    (await sql<{ y: number }>`select extract(year from ${localToday(zone.timezone)})::int as y`.execute(db)).rows[0]!.y;
  const goal = await db
    .selectFrom('reading_goals')
    .select('target')
    .where('profile_id', '=', profileId)
    .where('year', '=', goalYear)
    .executeTakeFirst();
  if (!goal) return undefined;
  return { profileId, year: goalYear, target: goal.target, booksRead: await booksRead(db, profileId, goalYear) };
}
