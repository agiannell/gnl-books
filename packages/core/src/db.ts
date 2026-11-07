import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { types } from 'pg';
import { withRetry, type RetryOptions } from './retry';
import type { DB } from './schema';

const DATE_OID = 1082;

/**
 * `pg` turns `date` columns into JS Dates in local time, which can land on the
 * previous or next day. Keep them as the plain `YYYY-MM-DD` string instead:
 * the Goodreads CSV needs the exact calendar date.
 */
export const typeParsers = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === DATE_OID ? (value: string) => value : types.getTypeParser(oid, format as 'text')) as typeof types.getTypeParser,
};

/** The app's typed database handle, so callers needn't depend on kysely directly. */
export type Db = Kysely<DB>;

export interface DbConfig {
  /** DSQL cluster endpoint, e.g. `<id>.dsql.us-west-2.on.aws`. */
  host: string;
  /** Defaults to `admin`, which the connector signs with an admin token. */
  user?: string;
  /** Lambdas run one request at a time, so a small pool is plenty. */
  max?: number;
}

/**
 * A Kysely instance over a DSQL pool. Connections are disposable: the connector
 * mints a fresh IAM token for each one, so there is nothing to refresh or keep
 * alive. Typed with the generated schema; pass another type only for code that
 * works on whatever schema exists, like the migration runner.
 */
export function createDb<D = DB>({ host, user = 'admin', max = 3 }: DbConfig): Kysely<D> {
  const pool = new AuroraDSQLPool({
    host,
    user,
    max,
    idleTimeoutMillis: 60_000,
    types: typeParsers,
    // Retry lives in `withTransaction`, around Kysely's own BEGIN/COMMIT.
    retry: { maxRetries: 0 },
  });
  return new Kysely<D>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * The only way `core` opens a transaction. `fn` is re-run from the top on an
 * optimistic-concurrency conflict, so it must be idempotent.
 */
export function withTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  return withRetry(() => db.transaction().execute(fn), options);
}
