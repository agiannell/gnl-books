import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, provisionAppRole, withTransaction } from '../src';

// Runs against a real DSQL cluster, so it only runs when DSQL_ENDPOINT is set
// (with AWS credentials and AWS_REGION in the environment). It creates a
// throwaway database role mapped to made-up IAM role ARNs, which DSQL accepts
// without the roles existing, and removes it afterwards. It never touches the
// API's real role, and it never connects as the new role: the mapping and the
// privileges are read back from the catalogs.
const endpoint = process.env.DSQL_ENDPOINT;
const ROLE = 'gnl_books_live_test';
const ARN_A = 'arn:aws:iam::111111111111:role/gnl-books-live-test-a';
const ARN_B = 'arn:aws:iam::111111111111:role/gnl-books-live-test-b';

describe.skipIf(!endpoint)('provisionAppRole against a real DSQL cluster', () => {
  let db: Kysely<any>;

  const run = (statement: string) => withTransaction(db, (trx) => sql.raw(statement).execute(trx));
  const mappings = async () =>
    (
      await withTransaction(db, (trx) =>
        sql<{ arn: string }>`select arn from sys.iam_pg_role_mappings where pg_role_name = ${ROLE}`.execute(trx),
      )
    ).rows.map((r) => r.arn);
  const can = async (privilege: string, table: string) =>
    (
      await withTransaction(db, (trx) =>
        sql<{ ok: boolean }>`select has_table_privilege(${ROLE}, ${table}, ${privilege}) as ok`.execute(trx),
      )
    ).rows[0].ok;

  async function remove() {
    for (const arn of await mappings()) await run(`aws iam revoke ${ROLE} from '${arn}'`);
    await run(`alter default privileges in schema public revoke select, insert, update, delete on tables from ${ROLE}`);
    await run(`revoke all on all tables in schema public from ${ROLE}`);
    await run(`drop role if exists ${ROLE}`);
  }

  beforeAll(async () => {
    db = createDb<any>({ host: endpoint! });
    // A leftover from a run that died halfway.
    await remove().catch(() => {});
  });

  afterAll(async () => {
    await remove().catch(() => {});
    await db.destroy();
  });

  it('creates the role, maps it, and gives it row access to the app tables but not the migration ledger', async () => {
    await provisionAppRole(db, { role: ROLE, roleArn: ARN_A });
    expect(await mappings()).toEqual([ARN_A]);
    for (const privilege of ['select', 'insert', 'update', 'delete']) {
      expect(await can(privilege, 'families'), privilege).toBe(true);
    }
    expect(await can('select', 'schema_migrations')).toBe(false);
    expect(await can('insert', 'schema_migrations')).toBe(false);
  });

  it('is safe to run again', async () => {
    await provisionAppRole(db, { role: ROLE, roleArn: ARN_A });
    expect(await mappings()).toEqual([ARN_A]);
  });

  it('moves the mapping to a replacement IAM role and drops the old one', async () => {
    await provisionAppRole(db, { role: ROLE, roleArn: ARN_B });
    expect(await mappings()).toEqual([ARN_B]);
  });

  it('covers a table created later, and still withholds the ledger', async () => {
    await run('create table if not exists app_role_live_probe (id uuid primary key)');
    try {
      expect(await can('select', 'app_role_live_probe')).toBe(true);
      await provisionAppRole(db, { role: ROLE, roleArn: ARN_B });
      expect(await can('delete', 'app_role_live_probe')).toBe(true);
      expect(await can('select', 'schema_migrations')).toBe(false);
    } finally {
      await run('drop table if exists app_role_live_probe');
    }
  });

  it('never gives the role the right to change the schema', async () => {
    const { rows } = await withTransaction(db, (trx) =>
      sql<{ create_on_schema: boolean; super: boolean; createrole: boolean }>`
        select has_schema_privilege(${ROLE}, 'public', 'CREATE') as create_on_schema,
               rolsuper as super, rolcreaterole as createrole
        from pg_roles where rolname = ${ROLE}`.execute(trx),
    );
    expect(rows[0]).toEqual({ create_on_schema: false, super: false, createrole: false });
  });
});
