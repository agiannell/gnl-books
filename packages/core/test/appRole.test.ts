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
import { provisionAppRole } from '../src/appRole';

// A Kysely instance over a fake driver that records every statement, serves the
// IAM mappings the catalog query asks for, and can fail one statement once.
function fakeDb(options: { mappings?: string[]; failOn?: (sql: string) => Error | undefined } = {}) {
  const log: string[] = [];
  const failed = new Set<string>();
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      const fail = options.failOn?.(query.sql);
      if (fail && !failed.has(query.sql)) {
        failed.add(query.sql);
        throw fail;
      }
      log.push(query.sql.trim());
      if (query.sql.startsWith('select arn from sys.iam_pg_role_mappings')) {
        log.push(`  params: ${JSON.stringify(query.parameters)}`);
        return { rows: (options.mappings ?? []).map((arn) => ({ arn })) as R[] };
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
  return { db, log, statements: () => log.filter((l) => !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(l) && !l.startsWith('  params')) };
}

const ARN = 'arn:aws:iam::111111111111:role/api';
const OLD_ARN = 'arn:aws:iam::111111111111:role/old-api';
const config = { role: 'app_role', roleArn: ARN };

describe('provisionAppRole', () => {
  it('creates the role, maps the IAM role, and grants row access, in that order', async () => {
    const { db, statements } = fakeDb();
    await provisionAppRole(db, config);
    expect(statements()).toEqual([
      'create role app_role with login',
      'select arn from sys.iam_pg_role_mappings where pg_role_name = $1',
      `aws iam grant app_role to '${ARN}'`,
      'alter default privileges in schema public grant select, insert, update, delete on tables to app_role',
      'grant select, insert, update, delete on all tables in schema public to app_role',
      'revoke all on table schema_migrations from app_role',
    ]);
  });

  it('runs every statement in its own transaction, because DSQL allows one DDL statement each', async () => {
    const { db, log } = fakeDb();
    await provisionAppRole(db, config);
    // Split the log at each BEGIN; every transaction must hold exactly one statement.
    const transactions = log
      .join('\n')
      .split('BEGIN\n')
      .slice(1)
      .map((t) => t.split('\n').filter((l) => l !== '' && l !== 'COMMIT' && !l.startsWith('  params')));
    expect(transactions).toHaveLength(6);
    for (const t of transactions) expect(t).toHaveLength(1);
  });

  it('looks up the mappings of this role only, with the name as a parameter', async () => {
    const { db, log } = fakeDb();
    await provisionAppRole(db, config);
    expect(log).toContain('  params: ["app_role"]');
  });

  it('leaves an existing role and an existing mapping alone', async () => {
    const { db, statements } = fakeDb({
      mappings: [ARN],
      failOn: (sql) => (sql.startsWith('create role') ? Object.assign(new Error('exists'), { code: '42710' }) : undefined),
    });
    await provisionAppRole(db, config);
    expect(statements().filter((s) => s.startsWith('aws iam'))).toEqual([]);
    expect(statements()).toContain('grant select, insert, update, delete on all tables in schema public to app_role');
  });

  it('unmaps an IAM role that is no longer the API, so a replaced role loses access', async () => {
    const { db, statements } = fakeDb({ mappings: [OLD_ARN] });
    await provisionAppRole(db, config);
    const iam = statements().filter((s) => s.startsWith('aws iam'));
    expect(iam).toEqual([`aws iam revoke app_role from '${OLD_ARN}'`, `aws iam grant app_role to '${ARN}'`]);
  });

  it('unmaps the stale role but does not remap the current one', async () => {
    const { db, statements } = fakeDb({ mappings: [OLD_ARN, ARN] });
    await provisionAppRole(db, config);
    expect(statements().filter((s) => s.startsWith('aws iam'))).toEqual([`aws iam revoke app_role from '${OLD_ARN}'`]);
  });

  it('takes the migration ledger away after the blanket grant, which would cover it', async () => {
    const { db, statements } = fakeDb();
    await provisionAppRole(db, config);
    const s = statements();
    expect(s.indexOf('revoke all on table schema_migrations from app_role')).toBeGreaterThan(
      s.indexOf('grant select, insert, update, delete on all tables in schema public to app_role'),
    );
  });

  it('fails on any create-role error other than "already exists"', async () => {
    const { db, statements } = fakeDb({
      failOn: (sql) => (sql.startsWith('create role') ? Object.assign(new Error('permission denied'), { code: '42501' }) : undefined),
    });
    await expect(provisionAppRole(db, config)).rejects.toThrow('permission denied');
    expect(statements()).toEqual([]);
  });

  it('logs what it changed, and stays quiet when nothing changed', async () => {
    const changed: string[] = [];
    await provisionAppRole(fakeDb().db, config, (m) => changed.push(m));
    expect(changed).toEqual(['created database role app_role', "mapped the API's IAM role to app_role"]);

    const quiet: string[] = [];
    const { db } = fakeDb({
      mappings: [ARN],
      failOn: (sql) => (sql.startsWith('create role') ? Object.assign(new Error('exists'), { code: '42710' }) : undefined),
    });
    await provisionAppRole(db, config, (m) => quiet.push(m));
    expect(quiet).toEqual([]);
  });

  describe('input checks, because both values are written into SQL text', () => {
    it.each([
      ['an ARN with a quote', "arn:aws:iam::111111111111:role/x' or '1'='1"],
      ['an ARN with a semicolon', 'arn:aws:iam::111111111111:role/x;drop table families'],
      ['a user ARN', 'arn:aws:iam::111111111111:user/someone'],
      ['not an ARN', 'api'],
      ['an empty string', ''],
    ])('rejects %s before running any SQL', async (_label, roleArn) => {
      const { db, log } = fakeDb();
      await expect(provisionAppRole(db, { role: 'app_role', roleArn })).rejects.toThrow('must look like arn:aws:iam');
      expect(log).toEqual([]);
    });

    it.each(['Admin', 'app role', 'app_role; drop table families', 'admin"', '1role', '', 'a'.repeat(64)])(
      'rejects the role name "%s" before running any SQL',
      async (role) => {
        const { db, log } = fakeDb();
        await expect(provisionAppRole(db, { role, roleArn: ARN })).rejects.toThrow('not a valid database role name');
        expect(log).toEqual([]);
      },
    );

    it('escapes a quote in a mapping read back from the catalog, rather than trusting it', async () => {
      const { db, statements } = fakeDb({ mappings: ["arn:aws:iam::111111111111:role/o'brien"] });
      await provisionAppRole(db, config);
      expect(statements()).toContain("aws iam revoke app_role from 'arn:aws:iam::111111111111:role/o''brien'");
    });
  });
});
