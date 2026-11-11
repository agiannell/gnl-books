import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { withTransaction, type Db } from './db';
import { isUuid } from './ids';

// A signed-in user with no family can ask to join one by naming a parent's
// email. A parent approves the request (behind the PIN) or denies it; nobody
// joins a family any other way. Requests are short-lived, capped per family,
// and asking never reveals whether a family exists.

/** How many open requests one family can have, so a stranger can't bury its parents in them. */
export const MAX_PENDING_REQUESTS = 5;
/** A request nobody answered stops counting, and stops being shown, after this long. */
export const REQUEST_LIFETIME_DAYS = 7;

export interface JoinRequest {
  id: string;
  /** The requester's verified email, shown to the parent so they know who is asking. */
  email: string;
  requestedAt: Date;
}

/** Emails are compared trimmed and lower-cased, and stored that way. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// The cut-off is computed by the database, so it agrees with `created_at`'s clock.
const alive = sql<Date>`now() - ${sql.lit(`${REQUEST_LIFETIME_DAYS} days`)}::interval`;

/**
 * Records that `cognitoSub` wants to join the family of the account whose email
 * is `parentEmail`, replacing any earlier request from the same user.
 *
 * It resolves the same way whether or not anything was recorded: an unknown
 * email, or a family that already has {@link MAX_PENDING_REQUESTS} open
 * requests, is silently ignored. Telling the caller would let anyone probe
 * which emails belong to families.
 */
export async function requestToJoin(
  db: Db,
  input: { cognitoSub: string; email: string; parentEmail: string },
): Promise<void> {
  const id = randomUUID();
  const email = normalizeEmail(input.email);
  const parentEmail = normalizeEmail(input.parentEmail);

  await withTransaction(db, async (trx) => {
    await trx.deleteFrom('join_requests').where('cognito_sub', '=', input.cognitoSub).execute();

    const parent = await trx
      .selectFrom('accounts')
      .select('family_id')
      .where('email', '=', parentEmail)
      .executeTakeFirst();
    if (!parent) return;

    await trx
      .deleteFrom('join_requests')
      .where('family_id', '=', parent.family_id)
      .where('created_at', '<=', alive)
      .execute();
    const { n } = await trx
      .selectFrom('join_requests')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('family_id', '=', parent.family_id)
      .executeTakeFirstOrThrow();
    if (Number(n) >= MAX_PENDING_REQUESTS) return;

    await trx
      .insertInto('join_requests')
      .values({ id, cognito_sub: input.cognitoSub, email, family_id: parent.family_id })
      .execute();
  });
}

/** The family's open requests, oldest first. */
export async function listJoinRequests(db: Db, familyId: string): Promise<JoinRequest[]> {
  const rows = await db
    .selectFrom('join_requests')
    .select(['id', 'email', 'created_at'])
    .where('family_id', '=', familyId)
    .where('created_at', '>', alive)
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({ id: r.id, email: r.email, requestedAt: new Date(r.created_at) }));
}

/**
 * Lets the requester in: they get an account in this family and the request is
 * gone. False when the request is not this family's, has expired, or is gone.
 * Someone who already has a family (they made their own meanwhile) is not
 * moved; their request is just removed.
 */
export async function approveJoinRequest(db: Db, familyId: string, requestId: string): Promise<boolean> {
  if (!isUuid(requestId)) return false;
  return withTransaction(db, async (trx) => {
    const request = await trx
      .selectFrom('join_requests')
      .selectAll()
      .where('id', '=', requestId)
      .where('family_id', '=', familyId)
      .where('created_at', '>', alive)
      .executeTakeFirst();
    if (!request) return false;

    await trx.deleteFrom('join_requests').where('id', '=', request.id).execute();
    const existing = await trx
      .selectFrom('accounts')
      .select('family_id')
      .where('cognito_sub', '=', request.cognito_sub)
      .executeTakeFirst();
    if (existing) return false;

    await trx
      .insertInto('accounts')
      .values({ cognito_sub: request.cognito_sub, family_id: familyId, email: request.email })
      .execute();
    return true;
  });
}

/** Turns a request down. False when it is not this family's or is already gone. */
export async function denyJoinRequest(db: Db, familyId: string, requestId: string): Promise<boolean> {
  if (!isUuid(requestId)) return false;
  const result = await db
    .deleteFrom('join_requests')
    .where('id', '=', requestId)
    .where('family_id', '=', familyId)
    .executeTakeFirst();
  return result.numDeletedRows > 0n;
}
