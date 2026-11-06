import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import { withTransaction } from './db';

// DSQL allows one DDL statement per transaction, and DDL and DML can't share
// one. So each migration file is exactly one statement, run in its own
// transaction, and its version is recorded in a second transaction. If the
// process dies between the two, the rerun repeats the DDL: write every
// migration idempotently (`if not exists`).

export interface Migration {
  /** The file name without `.sql`, e.g. `0001_create_families`. */
  version: string;
  sql: string;
}

const VERSION = /^(\d{4})_[a-z0-9_]+$/;

/** Reads `*.sql` files from `dir`, sorted by name, and checks their names. */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set<string>();
  const migrations: Migration[] = [];
  for (const file of files) {
    const version = path.basename(file, '.sql');
    const match = VERSION.exec(version);
    if (!match) throw new Error(`Migration "${file}" must be named NNNN_snake_case.sql`);
    if (seen.has(match[1])) throw new Error(`Two migrations share the number ${match[1]}`);
    seen.add(match[1]);
    migrations.push({ version, sql: await readFile(path.join(dir, file), 'utf8') });
  }
  return migrations;
}

/**
 * Rejects a migration holding more than one statement. This is a plain check,
 * not a SQL parser: it drops `--` comments and one trailing `;`, then refuses
 * any other `;`. Migrations must not contain a `;` inside a string literal.
 */
export function assertSingleStatement({ version, sql: text }: Migration): void {
  const body = text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .trim()
    .replace(/;$/, '');
  if (body === '') throw new Error(`Migration ${version} is empty`);
  if (body.includes(';')) throw new Error(`Migration ${version} has more than one statement`);
}

/** Applies every migration not yet recorded, in order. Returns the versions it applied. */
export async function migrate(
  // The runner works on whatever schema exists, so it can't be typed.
  db: Kysely<any>,
  migrations: Migration[],
  log: (message: string) => void = () => {},
): Promise<string[]> {
  // Check every file first, so a bad one can't leave the schema half-migrated.
  migrations.forEach(assertSingleStatement);

  await withTransaction(db, (trx) =>
    sql`create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`.execute(trx),
  );

  const { rows } = await withTransaction(db, (trx) =>
    sql<{ version: string }>`select version from schema_migrations`.execute(trx),
  );
  const done = new Set(rows.map((r) => r.version));

  const applied: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.version.localeCompare(b.version))) {
    if (done.has(m.version)) continue;
    log(`applying ${m.version}`);
    await withTransaction(db, (trx) => sql.raw(m.sql).execute(trx));
    await withTransaction(db, (trx) =>
      sql`insert into schema_migrations (version)
          select ${m.version}
          where not exists (select 1 from schema_migrations where version = ${m.version})`.execute(trx),
    );
    applied.push(m.version);
  }
  return applied;
}
