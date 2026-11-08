import { withTransaction, type Db } from './db';
import { verifyPin } from './pin';

// A 4-digit PIN has 10,000 values and the API allows many requests a second,
// so without a limit a signed-in kid could guess it in minutes.
export const MAX_PIN_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsRemaining: number }
  | { ok: false; reason: 'locked'; until: Date };

export interface PinState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

/**
 * What a PIN attempt does, given the stored state. Pure, so the rules can be
 * tested exhaustively; `attemptParentUnlock` wraps it in a transaction.
 *
 * The fifth wrong guess reports `locked`, not `wrong`. While a lock is in the
 * future the PIN is not even checked, and the lock is not extended.
 */
export function decideUnlock(
  state: PinState,
  pinCorrect: boolean,
  now: Date,
): { result: UnlockResult; next: PinState } {
  if (state.lockedUntil && state.lockedUntil > now) {
    return { result: { ok: false, reason: 'locked', until: state.lockedUntil }, next: state };
  }
  if (pinCorrect) return { result: { ok: true }, next: { failedAttempts: 0, lockedUntil: null } };

  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= MAX_PIN_ATTEMPTS) {
    const until = new Date(now.getTime() + LOCKOUT_MS);
    return { result: { ok: false, reason: 'locked', until }, next: { failedAttempts: 0, lockedUntil: until } };
  }
  return {
    result: { ok: false, reason: 'wrong', attemptsRemaining: MAX_PIN_ATTEMPTS - failedAttempts },
    next: { failedAttempts, lockedUntil: null },
  };
}

const sameState = (a: PinState, b: PinState) =>
  a.failedAttempts === b.failedAttempts && a.lockedUntil?.getTime() === b.lockedUntil?.getTime();

/**
 * Checks a PIN against the family's, counting failures and enforcing the lock.
 *
 * It returns a result for every outcome instead of throwing: a throw would roll
 * the transaction back and lose the failure count. Concurrent guesses write the
 * same row, so they conflict and retry one at a time, and none is missed.
 */
export async function attemptParentUnlock(
  db: Db,
  familyId: string,
  pin: string,
  now: () => Date = () => new Date(),
): Promise<UnlockResult> {
  return withTransaction(db, async (trx) => {
    const row = await trx
      .selectFrom('families')
      .select(['parent_pin_hash', 'failed_pin_attempts', 'pin_locked_until'])
      .where('id', '=', familyId)
      .executeTakeFirst();
    if (!row) throw new Error('Family not found');

    const at = now();
    const state: PinState = {
      // Null columns mean zero failures and not locked (DSQL cannot default them).
      failedAttempts: row.failed_pin_attempts ?? 0,
      lockedUntil: row.pin_locked_until,
    };
    const locked = state.lockedUntil !== null && state.lockedUntil > at;
    const pinCorrect = locked ? false : await verifyPin(pin, row.parent_pin_hash);

    const { result, next } = decideUnlock(state, pinCorrect, at);
    if (!sameState(state, next)) {
      await trx
        .updateTable('families')
        .set({ failed_pin_attempts: next.failedAttempts, pin_locked_until: next.lockedUntil })
        .where('id', '=', familyId)
        .execute();
    }
    return result;
  });
}
