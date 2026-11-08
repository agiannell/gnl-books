import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { createDb, type Db } from '../src/db';
import { attemptParentUnlock, LOCKOUT_MS, MAX_PIN_ATTEMPTS } from '../src/unlock';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. Each test
// makes its own family and everything is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;
const WRONG = '0000';
const RIGHT = '4821';

describe.skipIf(!endpoint)('attemptParentUnlock (live)', () => {
  let db: Db;
  const created: { familyId: string; sub: string }[] = [];

  async function newFamily() {
    const sub = `test-${randomUUID()}`;
    const family = await bootstrapFamily(db, { cognitoSub: sub, familyName: 'Unlock Test', parentName: 'Pat', pin: RIGHT });
    created.push({ familyId: family.id, sub });
    return family.id;
  }

  beforeAll(() => {
    // One connection per concurrent guess in the race test, plus one spare.
    db = createDb({ host: endpoint!, max: MAX_PIN_ATTEMPTS + 1 });
  });

  afterAll(async () => {
    for (const { familyId, sub } of created) {
      await db.deleteFrom('accounts').where('cognito_sub', '=', sub).execute();
      await db.deleteFrom('profiles').where('family_id', '=', familyId).execute();
      await db.deleteFrom('families').where('id', '=', familyId).execute();
    }
    await db.destroy();
  });

  it('accepts the right PIN on a family that has never failed (null columns)', async () => {
    const familyId = await newFamily();
    expect(await attemptParentUnlock(db, familyId, RIGHT)).toEqual({ ok: true });
  });

  it('persists the failure count across calls, and a success resets it', async () => {
    const familyId = await newFamily();
    expect(await attemptParentUnlock(db, familyId, WRONG)).toMatchObject({ reason: 'wrong', attemptsRemaining: 4 });
    expect(await attemptParentUnlock(db, familyId, WRONG)).toMatchObject({ reason: 'wrong', attemptsRemaining: 3 });
    expect(await attemptParentUnlock(db, familyId, RIGHT)).toEqual({ ok: true });
    // Back to a full allowance.
    expect(await attemptParentUnlock(db, familyId, WRONG)).toMatchObject({ reason: 'wrong', attemptsRemaining: 4 });
  });

  it('counts every guess when they arrive at the same time', async () => {
    const familyId = await newFamily();
    const results = await Promise.all(
      Array.from({ length: MAX_PIN_ATTEMPTS }, () => attemptParentUnlock(db, familyId, WRONG)),
    );
    // If two guesses read the same count and both wrote it back, one would be
    // lost and the lock would not trigger. Instead each lands once: four
    // distinct "wrong" answers and exactly one that tripped the lock.
    const remaining = results
      .flatMap((r) => (r.ok === false && r.reason === 'wrong' ? [r.attemptsRemaining] : []))
      .sort();
    expect(remaining).toEqual([1, 2, 3, 4]);
    expect(results.filter((r) => r.ok === false && r.reason === 'locked')).toHaveLength(1);
  });

  it('refuses the right PIN while locked, then accepts it once the lock has ended', async () => {
    const familyId = await newFamily();
    const start = new Date();
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) await attemptParentUnlock(db, familyId, WRONG, () => start);

    const during = await attemptParentUnlock(db, familyId, RIGHT, () => new Date(start.getTime() + 60_000));
    expect(during).toMatchObject({ ok: false, reason: 'locked' });

    const after = await attemptParentUnlock(db, familyId, RIGHT, () => new Date(start.getTime() + LOCKOUT_MS + 1000));
    expect(after).toEqual({ ok: true });

    const row = await db.selectFrom('families').select(['failed_pin_attempts', 'pin_locked_until']).where('id', '=', familyId).executeTakeFirstOrThrow();
    expect(row).toEqual({ failed_pin_attempts: 0, pin_locked_until: null });
  });

  it('reports an unknown family as an error, not as a wrong PIN', async () => {
    await expect(attemptParentUnlock(db, randomUUID(), RIGHT)).rejects.toThrow('Family not found');
  });
});
