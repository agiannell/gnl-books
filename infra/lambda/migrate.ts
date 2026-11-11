import path from 'node:path';
import { createDb, loadMigrations, migrate, provisionAppRole } from '@gnl-books/core';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Applies db/migrations to the DSQL cluster, then makes sure the API's limited
// database role exists and is mapped to the API's IAM role. A CDK Trigger
// invokes this on deploy, and fails the deploy if it throws. The stack copies
// the SQL files next to the bundle as `migrations/`.
export async function handler(): Promise<{ applied: string[] }> {
  const host = required('DSQL_ENDPOINT');
  const role = required('DSQL_APP_USER');
  const roleArn = required('DSQL_APP_ROLE_ARN');
  // The runner works on whatever schema exists, so it isn't typed.
  const db = createDb<any>({ host });
  try {
    const migrations = await loadMigrations(path.join(__dirname, 'migrations'));
    const applied = await migrate(db, migrations, (message) => console.log(message));
    console.log(applied.length ? `applied ${applied.length} migration(s)` : 'schema is up to date');
    // After the migrations, so the role's table grants cover any new tables.
    await provisionAppRole(db, { role, roleArn }, (message) => console.log(message));
    return { applied };
  } finally {
    await db.destroy();
  }
}
