import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import { bootstrapFamily, MAX_FAMILIES, TooManyFamiliesError } from '../src/bootstrap';
import type { Db } from '../src/db';

// A Kysely instance over a fake driver: the family count is whatever the test
// says, and every statement and transaction boundary is recorded.
function fakeDb(familyCount: number) {
  const log: string[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      log.push(query.sql.trim().split('\n')[0]);
      if (query.sql.includes('count(*)')) return { rows: [{ n: String(familyCount) }] as R[] };
      return { rows: [] };
    },
    streamQuery() {
      throw new Error('not used');
    },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async beginTransaction() {
      log.push('BEGIN');
    },
    async commitTransaction() {
      log.push('COMMIT');
    },
    async rollbackTransaction() {
      log.push('ROLLBACK');
    },
    async releaseConnection() {},
    async destroy() {},
  };
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  }) as unknown as Db;
  return { db, log };
}

const input = { cognitoSub: 'sub', email: 'a@example.test', familyName: 'F', parentName: 'P', pin: '1234' };

describe('bootstrapFamily family cap', () => {
  it(`refuses a new family once ${MAX_FAMILIES} exist, and writes nothing`, async () => {
    const { db, log } = fakeDb(MAX_FAMILIES);
    await expect(bootstrapFamily(db, input)).rejects.toBeInstanceOf(TooManyFamiliesError);
    expect(log.filter((l) => l.startsWith('insert') || l.startsWith('delete'))).toEqual([]);
    expect(log).toContain('ROLLBACK');
  });

  it('refuses when there are more than the cap, too', async () => {
    const { db } = fakeDb(MAX_FAMILIES + 7);
    await expect(bootstrapFamily(db, input)).rejects.toBeInstanceOf(TooManyFamiliesError);
  });

  it('makes the family when there is still room for one', async () => {
    const { db, log } = fakeDb(MAX_FAMILIES - 1);
    await expect(bootstrapFamily(db, input)).resolves.toMatchObject({ name: 'F' });
    expect(log.filter((l) => l.startsWith('insert into'))).toHaveLength(3);
    expect(log).toContain('COMMIT');
  });
});
