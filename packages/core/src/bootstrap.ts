import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { withTransaction, type Db } from './db';
import type { Family } from './families';
import { normalizeEmail } from './joinRequests';
import { hashPin } from './pin';

/** How many families the app will hold. The sign-up is open, so this keeps a bot from filling the database. */
export const MAX_FAMILIES = 100;

export class AlreadyBootstrappedError extends Error {
  constructor() {
    super('This account already belongs to a family');
    this.name = 'AlreadyBootstrappedError';
  }
}

export class TooManyFamiliesError extends Error {
  constructor() {
    super('The app is not taking new families right now');
    this.name = 'TooManyFamiliesError';
  }
}

export interface BootstrapInput {
  cognitoSub: string;
  /** The user's verified email, if Cognito has one. It lets a parent be found by email. */
  email?: string | null;
  familyName: string;
  parentName: string;
  pin: string;
}

/**
 * First-run setup: the family, its first parent profile, and the account that
 * links the Cognito user to it, all in one transaction. It also withdraws any
 * request the user made to join another family, since they chose this one.
 *
 * `withTransaction` re-runs the callback on a write conflict, so the ids and
 * the (slow) PIN hash are made once, outside it. Two simultaneous calls for the
 * same user conflict on `accounts`; the loser retries, sees the row, and throws.
 * The family cap is checked in the same transaction, but DSQL only detects
 * conflicting writes, so simultaneous sign-ups can overshoot it by a few.
 */
export async function bootstrapFamily(db: Db, input: BootstrapInput): Promise<Family> {
  const familyId = randomUUID();
  const profileId = randomUUID();
  const pinHash = await hashPin(input.pin);
  const email = input.email == null ? null : normalizeEmail(input.email);

  return withTransaction(db, async (trx) => {
    const existing = await trx
      .selectFrom('accounts')
      .select('family_id')
      .where('cognito_sub', '=', input.cognitoSub)
      .executeTakeFirst();
    if (existing) throw new AlreadyBootstrappedError();

    const { n } = await trx
      .selectFrom('families')
      .select(sql<string>`count(*)`.as('n'))
      .executeTakeFirstOrThrow();
    if (Number(n) >= MAX_FAMILIES) throw new TooManyFamiliesError();

    await trx.insertInto('families').values({ id: familyId, name: input.familyName, parent_pin_hash: pinHash }).execute();
    await trx
      .insertInto('profiles')
      .values({ id: profileId, family_id: familyId, name: input.parentName, is_parent: true })
      .execute();
    await trx.insertInto('accounts').values({ cognito_sub: input.cognitoSub, family_id: familyId, email }).execute();
    await trx.deleteFrom('join_requests').where('cognito_sub', '=', input.cognitoSub).execute();

    return { id: familyId, name: input.familyName };
  });
}
