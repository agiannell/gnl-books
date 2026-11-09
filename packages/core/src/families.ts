import type { Db } from './db';

/**
 * The zone a family's calendar dates are kept in when it has not set one. The
 * database clock is UTC, so without this a book finished at 7 pm Central is
 * dated tomorrow.
 */
export const DEFAULT_TIMEZONE = 'America/Chicago';

export interface Family {
  id: string;
  name: string;
}

/** The family a Cognito user belongs to, or undefined before first-run bootstrap. */
export async function findFamilyIdForAccount(
  db: Db,
  cognitoSub: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom('accounts')
    .select('family_id')
    .where('cognito_sub', '=', cognitoSub)
    .executeTakeFirst();
  return row?.family_id;
}

// `parent_pin_hash` is deliberately not selected: it never leaves the data layer.
export async function getFamily(db: Db, familyId: string): Promise<Family | undefined> {
  return db.selectFrom('families').select(['id', 'name']).where('id', '=', familyId).executeTakeFirst();
}
