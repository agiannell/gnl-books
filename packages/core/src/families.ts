import type { Db } from './db';

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
