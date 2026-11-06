import path from 'node:path';
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
import { assertSingleStatement, loadMigrations, migrate } from '../src/migrate';

// A Kysely instance over a fake driver that records every statement and
// transaction boundary, so the tests can assert how migrations are sequenced.
function fakeDb(options: { applied?: string[]; failOnce?: (sql: string) => Error | undefined } = {}) {
  const log: string[] = [];
  const failed = new Set<string>();

  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      const fail = options.failOnce?.(query.sql);
      if (fail && !failed.has(query.sql)) {
        failed.add(query.sql);
        log.push(`fail: ${query.sql.trim().split('\n')[0]}`);
        throw fail;
      }
      log.push(query.sql.trim().split('\n')[0]);
      if (query.sql.startsWith('select version')) {
        return { rows: (options.applied ?? []).map((version) => ({ version })) as R[] };
      }
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
  });
  return { db, log };
}

const m = (version: string, text = `create table if not exists ${version} (id uuid primary key)`) => ({
  version,
  sql: text,
});

describe('migrate', () => {
  it('runs each migration in its own transaction, then records it in another', async () => {
    const { db, log } = fakeDb();
    const applied = await migrate(db, [m('0001_a')]);

    expect(applied).toEqual(['0001_a']);
    const ddl = log.indexOf('create table if not exists 0001_a (id uuid primary key)');
    expect(log.slice(ddl - 1, ddl + 2)).toEqual([
      'BEGIN',
      'create table if not exists 0001_a (id uuid primary key)',
      'COMMIT',
    ]);
    // The version row is written afterwards, in a different transaction.
    const insert = log.findIndex((l) => l.startsWith('insert into schema_migrations'));
    expect(insert).toBeGreaterThan(ddl + 2);
    expect(log.slice(insert - 1, insert + 2)).toEqual([
      'BEGIN',
      'insert into schema_migrations (version)',
      'COMMIT',
    ]);
  });

  it('applies pending migrations in version order, whatever order they are given', async () => {
    const { db } = fakeDb();
    await expect(migrate(db, [m('0002_b'), m('0001_a')])).resolves.toEqual(['0001_a', '0002_b']);
  });

  it('skips migrations that are already recorded', async () => {
    const { db, log } = fakeDb({ applied: ['0001_a'] });
    await expect(migrate(db, [m('0001_a'), m('0002_b')])).resolves.toEqual(['0002_b']);
    expect(log.some((l) => l.includes('0001_a'))).toBe(false);
  });

  it('does nothing when everything is applied', async () => {
    const { db } = fakeDb({ applied: ['0001_a'] });
    await expect(migrate(db, [m('0001_a')])).resolves.toEqual([]);
  });

  it('retries a DDL statement that hits OC001', async () => {
    const { db, log } = fakeDb({
      failOnce: (s) => (s.includes('0001_a (id') ? Object.assign(new Error('schema changed'), { code: 'OC001' }) : undefined),
    });
    await expect(migrate(db, [m('0001_a')])).resolves.toEqual(['0001_a']);
    expect(log.filter((l) => l.includes('0001_a (id'))).toEqual([
      'fail: create table if not exists 0001_a (id uuid primary key)',
      'create table if not exists 0001_a (id uuid primary key)',
    ]);
    expect(log).toContain('ROLLBACK');
  });

  it('refuses a multi-statement migration before running anything', async () => {
    const { db, log } = fakeDb();
    await expect(migrate(db, [m('0001_a'), m('0002_b', 'select 1; select 2')])).rejects.toThrow(
      /0002_b has more than one statement/,
    );
    expect(log).toEqual([]);
  });
});

describe('assertSingleStatement', () => {
  it('accepts one statement with comments and a trailing semicolon', () => {
    expect(() => assertSingleStatement(m('0001_a', '-- note; with a semicolon\ncreate table t (id int);\n'))).not.toThrow();
  });

  it('rejects an empty migration', () => {
    expect(() => assertSingleStatement(m('0001_a', '-- nothing here\n'))).toThrow(/empty/);
  });
});

describe('the real migrations in db/migrations', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'db', 'migrations');

  it('are well named, sequential, and one idempotent statement each', async () => {
    const migrations = await loadMigrations(dir);
    expect(migrations.length).toBeGreaterThan(0);
    migrations.forEach((x, i) => {
      expect(x.version.slice(0, 4)).toBe(String(i + 1).padStart(4, '0'));
      expect(() => assertSingleStatement(x)).not.toThrow();
      expect(x.sql).toMatch(/if not exists/i);
    });
  });

  it('use no unsupported array column types', async () => {
    for (const x of await loadMigrations(dir)) {
      // `text[]` is an array type; the `'[]'` JSON default has a quote before the brackets.
      expect(x.sql, x.version).not.toMatch(/\w\[\]/);
    }
  });
});
