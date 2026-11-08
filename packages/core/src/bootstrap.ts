import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from './db';
import type { Family } from './families';
import { hashPin } from './pin';

export class AlreadyBootstrappedError extends Error {
  constructor() {
    super('This account already belongs to a family');
    this.name = 'AlreadyBootstrappedError';
  }
}

export interface BootstrapInput {
  cognitoSub: string;
  familyName: string;
  parentName: string;
  pin: string;
}

/**
 * First-run setup: the family, its first parent profile, and the account that
 * links the Cognito user to it, all in one transaction.
 *
 * `withTransaction` re-runs the callback on a write conflict, so the ids and
 * the (slow) PIN hash are made once, outside it. Two simultaneous calls for the
 * same user conflict on `accounts`; the loser retries, sees the row, and throws.
 */
export async function bootstrapFamily(db: Db, input: BootstrapInput): Promise<Family> {
  const familyId = randomUUID();
  const profileId = randomUUID();
  const pinHash = await hashPin(input.pin);

  return withTransaction(db, async (trx) => {
    const existing = await trx
      .selectFrom('accounts')
      .select('family_id')
      .where('cognito_sub', '=', input.cognitoSub)
      .executeTakeFirst();
    if (existing) throw new AlreadyBootstrappedError();

    await trx.insertInto('families').values({ id: familyId, name: input.familyName, parent_pin_hash: pinHash }).execute();
    await trx
      .insertInto('profiles')
      .values({ id: profileId, family_id: familyId, name: input.parentName, is_parent: true })
      .execute();
    await trx.insertInto('accounts').values({ cognito_sub: input.cognitoSub, family_id: familyId }).execute();

    return { id: familyId, name: input.familyName };
  });
}
