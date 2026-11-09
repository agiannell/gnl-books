import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { withTransaction, type Db } from './db';
import { isUuid } from './ids';
import { deleteProfileEntries } from './shelf';

export interface Profile {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  isParent: boolean;
}

export interface NewProfile {
  name: string;
  emoji?: string | undefined;
  color?: string | undefined;
  isParent?: boolean | undefined;
}

/** More than a family could want; it keeps a runaway client from filling the table. */
export const MAX_PROFILES = 20;

export class TooManyProfilesError extends Error {
  constructor() {
    super(`A family can have at most ${MAX_PROFILES} profiles`);
    this.name = 'TooManyProfilesError';
  }
}

export class LastProfileError extends Error {
  constructor() {
    super('A family needs at least one profile');
    this.name = 'LastProfileError';
  }
}

const columns = ['id', 'name', 'emoji', 'color', 'is_parent'] as const;
const toProfile = (row: { id: string; name: string; emoji: string | null; color: string | null; is_parent: boolean }): Profile => ({
  id: row.id,
  name: row.name,
  emoji: row.emoji,
  color: row.color,
  isParent: row.is_parent,
});

/** Every profile in the family, oldest first. */
export async function listProfiles(db: Db, familyId: string): Promise<Profile[]> {
  const rows = await db
    .selectFrom('profiles')
    .select(columns)
    .where('family_id', '=', familyId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map(toProfile);
}

/** The profile, only if it belongs to this family. Someone else's profile is the same as none. */
export async function getProfile(db: Db, familyId: string, profileId: string): Promise<Profile | undefined> {
  if (!isUuid(profileId)) return undefined;
  const row = await db
    .selectFrom('profiles')
    .select(columns)
    .where('id', '=', profileId)
    .where('family_id', '=', familyId)
    .executeTakeFirst();
  return row && toProfile(row);
}

/** Throws unless the family has another profile besides this one. */
async function requireAnotherProfile(db: Db, familyId: string, profileId: string): Promise<void> {
  const { n } = await db
    .selectFrom('profiles')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('family_id', '=', familyId)
    .where('id', '!=', profileId)
    .executeTakeFirstOrThrow();
  if (Number(n) === 0) throw new LastProfileError();
}

/**
 * Deletes a profile and everything under it: its shelf with every progress log
 * (batched and children first, see `deleteProfileEntries`), its goals, and its
 * Alexa device labels (the devices stay, unassigned). The profile row goes last,
 * so an interrupted delete leaves the profile in place to be deleted again.
 *
 * Refuses to delete the family's last profile. The final transaction rechecks
 * that and touches the family row, so two simultaneous deletes of the last two
 * profiles conflict and one retries and is refused, instead of both passing a
 * check neither's write would disturb. The loser's shelf is already gone by then.
 *
 * Returns false when the profile is not in this family.
 */
export async function deleteProfile(db: Db, familyId: string, profileId: string): Promise<boolean> {
  if (!(await getProfile(db, familyId, profileId))) return false;
  await requireAnotherProfile(db, familyId, profileId);
  await deleteProfileEntries(db, profileId);
  return withTransaction(db, async (trx) => {
    await requireAnotherProfile(trx, familyId, profileId);
    await trx.updateTable('families').set({ name: sql<string>`name` }).where('id', '=', familyId).execute();
    await trx.deleteFrom('reading_goals').where('profile_id', '=', profileId).execute();
    await trx.updateTable('alexa_devices').set({ profile_id: null }).where('profile_id', '=', profileId).execute();
    const result = await trx
      .deleteFrom('profiles')
      .where('id', '=', profileId)
      .where('family_id', '=', familyId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  });
}

/**
 * Adds a profile to the family. The limit is checked and the row written in one
 * transaction, but DSQL only detects conflicting writes, so two simultaneous
 * adds at the limit can both succeed. That overshoots by a profile or two, which
 * does not matter for a cap that is only a guard.
 */
export async function createProfile(db: Db, familyId: string, input: NewProfile): Promise<Profile> {
  const id = randomUUID();
  return withTransaction(db, async (trx) => {
    const { n } = await trx
      .selectFrom('profiles')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('family_id', '=', familyId)
      .executeTakeFirstOrThrow();
    if (Number(n) >= MAX_PROFILES) throw new TooManyProfilesError();

    const row = {
      id,
      family_id: familyId,
      name: input.name,
      emoji: input.emoji ?? null,
      color: input.color ?? null,
      is_parent: input.isParent ?? false,
    };
    await trx.insertInto('profiles').values(row).execute();
    return toProfile(row);
  });
}
