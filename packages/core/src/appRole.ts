import { sql, type Kysely } from 'kysely';
import { withTransaction } from './db';

// The API connects as a limited database role instead of `admin`: it can read
// and write rows but cannot change the schema, create roles, or map IAM roles.
// This is not a numbered migration because the IAM mapping needs the Lambda's
// role ARN, which only exists at deploy time. Like a migration, every step is
// one statement in its own transaction (DSQL allows one DDL statement per
// transaction) and is safe to repeat.

export interface AppRoleConfig {
  /** The database role the API connects as, e.g. `gnl_books_app`. */
  role: string;
  /** The IAM role the API's Lambda runs as; it is mapped to `role`. */
  roleArn: string;
}

const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;

/** What a `create role` collision reports in Postgres: `duplicate_object`. */
const DUPLICATE_OBJECT = '42710';

/** Never granted: the migration ledger belongs to the runner, not the API. */
const LEDGER_TABLE = 'schema_migrations';

/**
 * Creates the role, maps the Lambda's IAM role to it (and only it), and gives
 * it row access to every table, present and future. Safe to run on every deploy.
 *
 * Both values end up in SQL text (`aws iam grant` takes no parameters), so they
 * are checked against strict patterns first.
 */
export async function provisionAppRole(
  // Like the migration runner, it works on whatever schema exists.
  db: Kysely<any>,
  { role, roleArn }: AppRoleConfig,
  log: (message: string) => void = () => {},
): Promise<void> {
  if (!ROLE_NAME.test(role)) throw new Error(`"${role}" is not a valid database role name`);
  if (!ROLE_ARN.test(roleArn)) throw new Error('The app role ARN must look like arn:aws:iam::<account>:role/<name>');

  const run = (statement: string) => withTransaction(db, (trx) => sql.raw(statement).execute(trx));

  try {
    await run(`create role ${role} with login`);
    log(`created database role ${role}`);
  } catch (error) {
    if ((error as { code?: string }).code !== DUPLICATE_OBJECT) throw error;
  }

  // A replaced Lambda role has a new ARN. The old one must lose access, so the
  // role ends up mapped to exactly one IAM role.
  const { rows } = await withTransaction(db, (trx) =>
    sql<{ arn: string }>`select arn from sys.iam_pg_role_mappings where pg_role_name = ${role}`.execute(trx),
  );
  const mapped = rows.map((r) => r.arn);
  for (const arn of mapped.filter((a) => a !== roleArn)) {
    await run(`aws iam revoke ${role} from '${arn.replaceAll("'", "''")}'`);
    log(`unmapped a stale IAM role from ${role}`);
  }
  if (!mapped.includes(roleArn)) {
    await run(`aws iam grant ${role} to '${roleArn}'`);
    log(`mapped the API's IAM role to ${role}`);
  }

  const rowAccess = 'select, insert, update, delete';
  await run(`alter default privileges in schema public grant ${rowAccess} on tables to ${role}`);
  await run(`grant ${rowAccess} on all tables in schema public to ${role}`);
  // After the blanket grant, which covers it.
  await run(`revoke all on table ${LEDGER_TABLE} from ${role}`);
}
