import { sql } from 'kysely';
import { withTransaction, type Db } from './db';
import { normalizeEmail } from './joinRequests';

/**
 * The zone a family's calendar dates are kept in when it has not set one. The
 * database clock is UTC, so without this a book finished at 7 pm Central is
 * dated tomorrow.
 */
export const DEFAULT_TIMEZONE = 'America/Chicago';

/**
 * The zones a family can choose: the IANA names this runtime knows, plus UTC (which the
 * list leaves out). A name is checked against this before the database is asked, so
 * Postgres' looser forms ("EST", "PST8PDT", "+05") never get stored.
 */
export const TIMEZONES: readonly string[] = [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])].sort();

export class InvalidTimezoneError extends Error {
  constructor() {
    super('Time zone not recognized');
    this.name = 'InvalidTimezoneError';
  }
}

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

/**
 * Stores the account's verified email if it has none yet, so a new user can name this parent to ask to
 * join. Accounts made before emails were kept (or by hand) get theirs the first time they are used.
 * `lookup` is only called for an account that has no email, and an email already stored is never replaced.
 */
export async function backfillAccountEmail(
  db: Db,
  cognitoSub: string,
  lookup: () => Promise<string | null>,
): Promise<void> {
  const account = await db.selectFrom('accounts').select('email').where('cognito_sub', '=', cognitoSub).executeTakeFirst();
  if (!account || account.email !== null) return;
  const email = await lookup();
  if (!email) return;
  await withTransaction(db, (trx) =>
    trx
      .updateTable('accounts')
      .set({ email: normalizeEmail(email) })
      .where('cognito_sub', '=', cognitoSub)
      .where('email', 'is', null)
      .execute(),
  );
}

/** The zone the family's dates are kept in: the one it chose, else the default. */
export async function getFamilyTimezone(db: Db, familyId: string): Promise<string> {
  const row = await db.selectFrom('families').select('timezone').where('id', '=', familyId).executeTakeFirst();
  return row?.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * Changes the zone every later date stamp uses (dates already written stay as they are). The name
 * must be one of TIMEZONES and one the database accepts: a zone the database rejected would make
 * every date stamp for the family fail, so it is checked here rather than found later.
 */
export async function setFamilyTimezone(db: Db, familyId: string, timezone: string): Promise<void> {
  if (!TIMEZONES.includes(timezone)) throw new InvalidTimezoneError();
  try {
    await sql`select now() at time zone ${timezone}`.execute(db);
  } catch (error) {
    // 22023 is "invalid_parameter_value", which is what an unknown zone name raises.
    if ((error as { code?: string }).code === '22023') throw new InvalidTimezoneError();
    throw error;
  }
  await db.updateTable('families').set({ timezone }).where('id', '=', familyId).execute();
}

// `parent_pin_hash` is deliberately not selected: it never leaves the data layer.
export async function getFamily(db: Db, familyId: string): Promise<Family | undefined> {
  return db.selectFrom('families').select(['id', 'name']).where('id', '=', familyId).executeTakeFirst();
}
