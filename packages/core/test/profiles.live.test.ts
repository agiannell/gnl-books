import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { createDb, type Db } from '../src/db';
import { createProfile, getProfile, listProfiles, MAX_PROFILES, TooManyProfilesError } from '../src/profiles';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. Every
// family it makes is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('profiles (live)', () => {
  let db: Db;
  const made: { familyId: string; sub: string }[] = [];

  const newFamily = async (parentName = 'Pat') => {
    const sub = `test-${randomUUID()}`;
    const family = await bootstrapFamily(db, { cognitoSub: sub, familyName: 'Test Family', parentName, pin: '4821' });
    made.push({ familyId: family.id, sub });
    return family.id;
  };

  beforeAll(() => {
    db = createDb({ host: endpoint!, max: 4 });
  });

  afterAll(async () => {
    // Children first: the foreign keys are NO ACTION, not CASCADE.
    for (const { familyId, sub } of made) {
      await db.deleteFrom('accounts').where('cognito_sub', '=', sub).execute();
      await db.deleteFrom('profiles').where('family_id', '=', familyId).execute();
      await db.deleteFrom('families').where('id', '=', familyId).execute();
    }
    await db.destroy();
  });

  it('lists the bootstrap parent, then new profiles in the order they were made', async () => {
    const familyId = await newFamily('Pat');
    await createProfile(db, familyId, { name: 'Sam', emoji: '🦊', color: '#3366cc' });
    await createProfile(db, familyId, { name: 'Alex' });
    const profiles = await listProfiles(db, familyId);
    expect(profiles.map((p) => p.name)).toEqual(['Pat', 'Sam', 'Alex']);
    expect(profiles[0]).toMatchObject({ isParent: true });
    expect(profiles[1]).toEqual({ id: expect.any(String), name: 'Sam', emoji: '🦊', color: '#3366cc', isParent: false });
    expect(profiles[2]).toMatchObject({ emoji: null, color: null, isParent: false });
  });

  it('makes a second adult a parent profile only when asked', async () => {
    const familyId = await newFamily();
    const adult = await createProfile(db, familyId, { name: 'Jo', isParent: true });
    expect(adult.isParent).toBe(true);
    expect((await getProfile(db, familyId, adult.id))?.isParent).toBe(true);
  });

  it('never shows one family another family’s profiles', async () => {
    const a = await newFamily('Alice');
    const b = await newFamily('Bob');
    const bobs = await listProfiles(db, b);
    expect(bobs).toHaveLength(1);

    expect(await getProfile(db, a, bobs[0]!.id)).toBeUndefined();
    expect(await getProfile(db, b, bobs[0]!.id)).toMatchObject({ name: 'Bob' });
    expect((await listProfiles(db, a)).map((p) => p.name)).toEqual(['Alice']);
  });

  it.each(['', 'abc', 'not-a-uuid', "1'; drop table profiles; --"])('treats %j as no profile, not a server error', async (id) => {
    const familyId = await newFamily();
    expect(await getProfile(db, familyId, id)).toBeUndefined();
  });

  it('is undefined for a well-formed id that does not exist', async () => {
    const familyId = await newFamily();
    expect(await getProfile(db, familyId, randomUUID())).toBeUndefined();
  });

  it(`stops at ${MAX_PROFILES} profiles`, async () => {
    const familyId = await newFamily();
    for (let i = 1; i < MAX_PROFILES; i++) await createProfile(db, familyId, { name: `Kid ${i}` });
    expect(await listProfiles(db, familyId)).toHaveLength(MAX_PROFILES);
    await expect(createProfile(db, familyId, { name: 'One too many' })).rejects.toBeInstanceOf(TooManyProfilesError);
    expect(await listProfiles(db, familyId)).toHaveLength(MAX_PROFILES);
  });
});
