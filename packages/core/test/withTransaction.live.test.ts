import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, isRetryable, withTransaction } from '../src';

// Runs against a real DSQL cluster, so it only runs when DSQL_ENDPOINT is set
// (with AWS credentials and AWS_REGION in the environment). It writes two
// throwaway `families` rows and deletes them afterwards.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('withTransaction against a real DSQL cluster', () => {
  const WORKERS = 5;
  let db: Kysely<any>;
  const familyIds: string[] = [];

  beforeAll(() => {
    // Every worker holds a connection while it waits at the barrier, so the
    // pool must be at least as big as WORKERS or they would deadlock.
    db = createDb<any>({ host: endpoint!, max: WORKERS + 1 });
  });

  afterAll(async () => {
    for (const id of familyIds) {
      await withTransaction(db, (trx) => sql`delete from families where id = ${id}`.execute(trx));
    }
    await db.destroy();
  });

  // A counter stored in a row, so a lost update shows up as a wrong total.
  async function newCounter(): Promise<string> {
    const id = randomUUID();
    familyIds.push(id);
    await withTransaction(db, (trx) =>
      sql`insert into families (id, name, parent_pin_hash) values (${id}, 'conflict test', '0')`.execute(trx),
    );
    return id;
  }

  async function readCounter(id: string): Promise<number> {
    const { rows } = await sql<{ v: string }>`select parent_pin_hash as v from families where id = ${id}`.execute(db);
    return Number(rows[0].v);
  }

  // Starts WORKERS read-then-increment transactions that all read the counter
  // before any of them writes, so every one but the first to commit conflicts.
  // `open` is how a transaction gets opened: with or without retry.
  async function raceIncrements(
    id: string,
    open: (body: (trx: Transaction<any>) => Promise<void>) => Promise<void>,
  ) {
    let readers = 0;
    let release!: () => void;
    const allHaveRead = new Promise<void>((resolve) => (release = resolve));
    let attempts = 0;

    const results = await Promise.allSettled(
      Array.from({ length: WORKERS }, () => {
        let firstAttempt = true;
        return open(async (trx) => {
          attempts++;
          const { rows } = await sql<{ v: string }>`select parent_pin_hash as v from families where id = ${id}`.execute(trx);
          // Only a worker's first attempt waits; retries run straight through.
          if (firstAttempt) {
            firstAttempt = false;
            if (++readers === WORKERS) release();
            await allHaveRead;
          }
          await sql`update families set parent_pin_hash = ${String(Number(rows[0].v) + 1)} where id = ${id}`.execute(trx);
        });
      }),
    );
    return { results, attempts };
  }

  it('without retry, concurrent writers conflict with a retryable error', async () => {
    const id = await newCounter();
    const { results } = await raceIncrements(id, (body) => db.transaction().execute(body));

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failures.length).toBeGreaterThan(0);
    for (const f of failures) {
      expect(isRetryable(f.reason), `unexpected error: ${f.reason?.code} ${f.reason?.message}`).toBe(true);
    }
    // Only committed increments count: a conflict never loses or half-applies an update.
    expect(await readCounter(id)).toBe(results.length - failures.length);
  });

  it('with withTransaction, every writer lands and no update is lost', async () => {
    const id = await newCounter();
    const { results, attempts } = await raceIncrements(id, (body) => withTransaction(db, body));

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await readCounter(id)).toBe(WORKERS);
    // More attempts than workers proves a conflict happened and was retried.
    expect(attempts).toBeGreaterThan(WORKERS);
  });
});
