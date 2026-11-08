import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from './db';

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

// A profile id comes from a client. Postgres raises on text that is not a
// uuid, which would read as a server error rather than "no such profile".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID.test(profileId)) return undefined;
  const row = await db
    .selectFrom('profiles')
    .select(columns)
    .where('id', '=', profileId)
    .where('family_id', '=', familyId)
    .executeTakeFirst();
  return row && toProfile(row);
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
