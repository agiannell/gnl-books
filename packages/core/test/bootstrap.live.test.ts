import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlreadyBootstrappedError, bootstrapFamily } from '../src/bootstrap';
import { createDb, type Db } from '../src/db';
import { verifyPin } from '../src/pin';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. See
// CLAUDE.md for the command. Each run uses a fresh random Cognito subject and
// removes everything it created.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('bootstrapFamily (live)', () => {
  // Created in beforeAll: the body of a skipped suite still runs, and
  // createDb throws without a host.
  let db: Db;
  const created: { familyId?: string; sub: string }[] = [];

  beforeAll(() => {
    db = createDb({ host: endpoint! });
  });

  afterAll(async () => {
    // Children first: the foreign keys are NO ACTION, not CASCADE.
    for (const { familyId, sub } of created) {
      await db.deleteFrom('accounts').where('cognito_sub', '=', sub).execute();
      if (familyId) {
        await db.deleteFrom('profiles').where('family_id', '=', familyId).execute();
        await db.deleteFrom('families').where('id', '=', familyId).execute();
      }
    }
    await db.destroy();
  });

  it('creates the family, a parent profile, and the account together', async () => {
    const sub = `test-${randomUUID()}`;
    const entry: (typeof created)[number] = { sub };
    created.push(entry);

    const family = await bootstrapFamily(db, { cognitoSub: sub, familyName: 'Test Family', parentName: 'Pat', pin: '4821' });
    entry.familyId = family.id;
    expect(family.name).toBe('Test Family');

    const row = await db.selectFrom('families').selectAll().where('id', '=', family.id).executeTakeFirstOrThrow();
    expect(await verifyPin('4821', row.parent_pin_hash)).toBe(true);
    expect(row.parent_pin_hash).not.toContain('4821');

    const profiles = await db.selectFrom('profiles').selectAll().where('family_id', '=', family.id).execute();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ name: 'Pat', is_parent: true });

    const account = await db.selectFrom('accounts').selectAll().where('cognito_sub', '=', sub).executeTakeFirstOrThrow();
    expect(account.family_id).toBe(family.id);
  });

  it('refuses a second family for the same account and leaves nothing behind', async () => {
    const sub = `test-${randomUUID()}`;
    const entry: (typeof created)[number] = { sub };
    created.push(entry);
    entry.familyId = (await bootstrapFamily(db, { cognitoSub: sub, familyName: 'First', parentName: 'Pat', pin: '4821' })).id;

    await expect(
      bootstrapFamily(db, { cognitoSub: sub, familyName: 'Second', parentName: 'Pat', pin: '4821' }),
    ).rejects.toBeInstanceOf(AlreadyBootstrappedError);

    const families = await db.selectFrom('families').select('id').where('name', '=', 'Second').execute();
    expect(families).toHaveLength(0);
  });

  it('lets exactly one of several simultaneous calls win', async () => {
    const sub = `test-${randomUUID()}`;
    const entry: (typeof created)[number] = { sub };
    created.push(entry);

    const results = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        bootstrapFamily(db, { cognitoSub: sub, familyName: `Race ${i}`, parentName: 'Pat', pin: '4821' }),
      ),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(AlreadyBootstrappedError);
    }
    entry.familyId = (won[0] as PromiseFulfilledResult<{ id: string }>).value.id;

    const accounts = await db.selectFrom('accounts').select('family_id').where('cognito_sub', '=', sub).execute();
    expect(accounts).toHaveLength(1);
    const families = await db.selectFrom('families').select('id').where('name', 'like', 'Race %').execute();
    expect(families).toHaveLength(1);
  });
});
