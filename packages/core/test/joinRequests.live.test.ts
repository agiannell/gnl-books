import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFamily } from '../src/bootstrap';
import { createDb, type Db } from '../src/db';
import { backfillAccountEmail } from '../src/families';
import {
  approveJoinRequest,
  denyJoinRequest,
  listJoinRequests,
  MAX_PENDING_REQUESTS,
  requestToJoin,
} from '../src/joinRequests';
import type { DB } from '../src/schema';

// Runs against a real database, so it only runs when one is named: DSQL_ENDPOINT
// (with AWS credentials and AWS_REGION) for the cluster, or LOCAL_PG_URL for a
// throwaway local Postgres that has the migrations applied. Every row it makes
// is removed afterwards.
const endpoint = process.env.DSQL_ENDPOINT;
const localUrl = process.env.LOCAL_PG_URL;

describe.skipIf(!endpoint && !localUrl)('join requests (live)', () => {
  let db: Db;
  const families: string[] = [];
  const subs: string[] = [];

  beforeAll(() => {
    db = localUrl
      ? new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: localUrl }) }) })
      : createDb({ host: endpoint! });
  });

  afterAll(async () => {
    if (subs.length) {
      await db.deleteFrom('join_requests').where('cognito_sub', 'in', subs).execute();
      await db.deleteFrom('accounts').where('cognito_sub', 'in', subs).execute();
    }
    if (families.length) {
      await db.deleteFrom('join_requests').where('family_id', 'in', families).execute();
      await db.deleteFrom('accounts').where('family_id', 'in', families).execute();
      await db.deleteFrom('profiles').where('family_id', 'in', families).execute();
      await db.deleteFrom('families').where('id', 'in', families).execute();
    }
    await db.destroy();
  }, 60_000);

  /** A family with one parent account whose email is unique to this test. */
  async function newFamily() {
    const sub = randomUUID();
    const email = `parent-${sub}@example.test`;
    subs.push(sub);
    const family = await bootstrapFamily(db, { cognitoSub: sub, email, familyName: 'Join test', parentName: 'P', pin: '1234' });
    families.push(family.id);
    return { familyId: family.id, sub, email };
  }

  /** A signed-in stranger who has no family. */
  function newStranger() {
    const sub = randomUUID();
    subs.push(sub);
    return { sub, email: `stranger-${sub}@example.test` };
  }

  const requestsFor = (familyId: string) => listJoinRequests(db, familyId);
  const accountFamily = async (sub: string) =>
    (await db.selectFrom('accounts').select('family_id').where('cognito_sub', '=', sub).executeTakeFirst())?.family_id;

  describe('asking', () => {
    it('records a request against the family of the parent whose email was named', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      expect(await requestsFor(parent.familyId)).toEqual([
        { id: expect.any(String), email: stranger.email, requestedAt: expect.any(Date) },
      ]);
    });

    it('matches the parent’s email without regard to case or surrounding spaces, and stores the requester’s the same way', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, {
        cognitoSub: stranger.sub,
        email: `  ${stranger.email.toUpperCase()} `,
        parentEmail: `  ${parent.email.toUpperCase()}  `,
      });
      expect((await requestsFor(parent.familyId)).map((r) => r.email)).toEqual([stranger.email]);
    });

    it('stores the parent’s email lower-cased when the family is made', async () => {
      const sub = randomUUID();
      subs.push(sub);
      const family = await bootstrapFamily(db, { cognitoSub: sub, email: `Mixed-${sub}@Example.TEST`, familyName: 'Case', parentName: 'P', pin: '1234' });
      families.push(family.id);
      const row = await db.selectFrom('accounts').select('email').where('cognito_sub', '=', sub).executeTakeFirstOrThrow();
      expect(row.email).toBe(`mixed-${sub}@example.test`);
    });

    it('says nothing, and records nothing, for an email that belongs to no family', async () => {
      const stranger = newStranger();
      await expect(
        requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: `nobody-${randomUUID()}@example.test` }),
      ).resolves.toBeUndefined();
      const rows = await db.selectFrom('join_requests').select('id').where('cognito_sub', '=', stranger.sub).execute();
      expect(rows).toEqual([]);
    });

    it('gives the same result for a real and a made-up email, so nobody can probe for families', async () => {
      const parent = await newFamily();
      const a = newStranger();
      const b = newStranger();
      const real = await requestToJoin(db, { cognitoSub: a.sub, email: a.email, parentEmail: parent.email });
      const fake = await requestToJoin(db, { cognitoSub: b.sub, email: b.email, parentEmail: `nobody-${randomUUID()}@example.test` });
      expect(real).toEqual(fake);
    });

    it('keeps one request per user: a new one replaces the old, even if the new email is unknown', async () => {
      const first = await newFamily();
      const second = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: first.email });
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: second.email });
      expect(await requestsFor(first.familyId)).toEqual([]);
      expect(await requestsFor(second.familyId)).toHaveLength(1);

      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: `nobody-${randomUUID()}@example.test` });
      expect(await requestsFor(second.familyId)).toEqual([]);
    });

    it(`ignores requests beyond ${MAX_PENDING_REQUESTS} open ones, and lets an expired one free its place`, async () => {
      const parent = await newFamily();
      const strangers = Array.from({ length: MAX_PENDING_REQUESTS + 1 }, newStranger);
      for (const s of strangers) await requestToJoin(db, { cognitoSub: s.sub, email: s.email, parentEmail: parent.email });
      const open = await requestsFor(parent.familyId);
      expect(open).toHaveLength(MAX_PENDING_REQUESTS);
      expect(open.map((r) => r.email)).not.toContain(strangers[MAX_PENDING_REQUESTS].email);

      await db
        .updateTable('join_requests')
        .set({ created_at: sql<Date>`now() - interval '8 days'` })
        .where('cognito_sub', '=', strangers[0].sub)
        .execute();
      await requestToJoin(db, { cognitoSub: strangers[MAX_PENDING_REQUESTS].sub, email: strangers[MAX_PENDING_REQUESTS].email, parentEmail: parent.email });
      const after = (await requestsFor(parent.familyId)).map((r) => r.email);
      expect(after).toHaveLength(MAX_PENDING_REQUESTS);
      expect(after).toContain(strangers[MAX_PENDING_REQUESTS].email);
      expect(after).not.toContain(strangers[0].email);
    });
  });

  describe('listing', () => {
    it('shows only this family’s requests, oldest first, and not expired ones', async () => {
      const parent = await newFamily();
      const other = await newFamily();
      const [a, b, c] = [newStranger(), newStranger(), newStranger()];
      await requestToJoin(db, { cognitoSub: a.sub, email: a.email, parentEmail: parent.email });
      await requestToJoin(db, { cognitoSub: b.sub, email: b.email, parentEmail: parent.email });
      await requestToJoin(db, { cognitoSub: c.sub, email: c.email, parentEmail: other.email });
      await db.updateTable('join_requests').set({ created_at: sql<Date>`now() - interval '1 hour'` }).where('cognito_sub', '=', b.sub).execute();

      expect((await requestsFor(parent.familyId)).map((r) => r.email)).toEqual([b.email, a.email]);

      await db.updateTable('join_requests').set({ created_at: sql<Date>`now() - interval '8 days'` }).where('cognito_sub', '=', b.sub).execute();
      expect((await requestsFor(parent.familyId)).map((r) => r.email)).toEqual([a.email]);
    });
  });

  describe('answering', () => {
    it('approving gives the requester an account in the family, with their email, and removes the request', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      const [request] = await requestsFor(parent.familyId);

      expect(await approveJoinRequest(db, parent.familyId, request.id)).toBe(true);
      expect(await accountFamily(stranger.sub)).toBe(parent.familyId);
      const account = await db.selectFrom('accounts').select('email').where('cognito_sub', '=', stranger.sub).executeTakeFirstOrThrow();
      expect(account.email).toBe(stranger.email);
      expect(await requestsFor(parent.familyId)).toEqual([]);
    });

    it('cannot be approved twice', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      const [request] = await requestsFor(parent.familyId);
      expect(await approveJoinRequest(db, parent.familyId, request.id)).toBe(true);
      expect(await approveJoinRequest(db, parent.familyId, request.id)).toBe(false);
    });

    it('will not approve, or deny, another family’s request', async () => {
      const parent = await newFamily();
      const outsider = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      const [request] = await requestsFor(parent.familyId);

      expect(await approveJoinRequest(db, outsider.familyId, request.id)).toBe(false);
      expect(await denyJoinRequest(db, outsider.familyId, request.id)).toBe(false);
      expect(await accountFamily(stranger.sub)).toBeUndefined();
      expect(await requestsFor(parent.familyId)).toHaveLength(1);
    });

    it('will not approve an expired request', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      const [request] = await requestsFor(parent.familyId);
      await db.updateTable('join_requests').set({ created_at: sql<Date>`now() - interval '8 days'` }).where('id', '=', request.id).execute();
      expect(await approveJoinRequest(db, parent.familyId, request.id)).toBe(false);
      expect(await accountFamily(stranger.sub)).toBeUndefined();
    });

    it.each(['not-a-uuid', '', "' or 1=1 --"])('treats a malformed id (%j) as not found', async (id) => {
      const parent = await newFamily();
      expect(await approveJoinRequest(db, parent.familyId, id)).toBe(false);
      expect(await denyJoinRequest(db, parent.familyId, id)).toBe(false);
    });

    it('denying removes the request and gives no account', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      const [request] = await requestsFor(parent.familyId);
      expect(await denyJoinRequest(db, parent.familyId, request.id)).toBe(true);
      expect(await requestsFor(parent.familyId)).toEqual([]);
      expect(await accountFamily(stranger.sub)).toBeUndefined();
      expect(await denyJoinRequest(db, parent.familyId, request.id)).toBe(false);
    });

    it('does not move someone who made their own family meanwhile, and just clears the request', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      const [request] = await requestsFor(parent.familyId);
      // An account appears without going through bootstrap, which would have withdrawn the request.
      const own = await newFamily();
      await db.insertInto('accounts').values({ cognito_sub: stranger.sub, family_id: own.familyId }).execute();

      expect(await approveJoinRequest(db, parent.familyId, request.id)).toBe(false);
      expect(await accountFamily(stranger.sub)).toBe(own.familyId);
      expect(await requestsFor(parent.familyId)).toEqual([]);
    });
  });

  describe('filling in an account’s email later', () => {
    const emailOf = async (sub: string) =>
      (await db.selectFrom('accounts').select('email').where('cognito_sub', '=', sub).executeTakeFirstOrThrow()).email;
    /** An account made the way the first ones were, before emails were kept. */
    async function accountWithoutEmail() {
      const family = await newFamily();
      await db.updateTable('accounts').set({ email: null }).where('cognito_sub', '=', family.sub).execute();
      return family;
    }

    it('stores the looked-up email, lower-cased, on an account that has none, so a stranger can then name this parent', async () => {
      const parent = await accountWithoutEmail();
      expect(await emailOf(parent.sub)).toBeNull();
      await backfillAccountEmail(db, parent.sub, async () => `  ${parent.email.toUpperCase()} `);
      expect(await emailOf(parent.sub)).toBe(parent.email);

      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      expect(await requestsFor(parent.familyId)).toHaveLength(1);
    });

    it('does not even look the email up when the account already has one, and never replaces it', async () => {
      const parent = await newFamily();
      let looked = 0;
      await backfillAccountEmail(db, parent.sub, async () => (looked++, 'someone-else@example.test'));
      expect(looked).toBe(0);
      expect(await emailOf(parent.sub)).toBe(parent.email);
    });

    it('leaves the account alone when there is no verified email to store', async () => {
      const parent = await accountWithoutEmail();
      await backfillAccountEmail(db, parent.sub, async () => null);
      expect(await emailOf(parent.sub)).toBeNull();
    });

    it('does nothing for someone with no account', async () => {
      let looked = 0;
      await backfillAccountEmail(db, randomUUID(), async () => (looked++, 'x@example.test'));
      expect(looked).toBe(0);
    });
  });

  describe('making a family', () => {
    it('withdraws a request the user made to join another family', async () => {
      const parent = await newFamily();
      const stranger = newStranger();
      await requestToJoin(db, { cognitoSub: stranger.sub, email: stranger.email, parentEmail: parent.email });
      expect(await requestsFor(parent.familyId)).toHaveLength(1);

      const own = await bootstrapFamily(db, { cognitoSub: stranger.sub, email: stranger.email, familyName: 'Mine', parentName: 'S', pin: '1234' });
      families.push(own.id);
      expect(await requestsFor(parent.familyId)).toEqual([]);
      expect(await accountFamily(stranger.sub)).toBe(own.id);
    });
  });
});
