import path from 'node:path';
import { createDb, loadMigrations, migrate } from '@gnl-books/core';

// Applies db/migrations to the DSQL cluster. A CDK Trigger invokes this on
// deploy, and fails the deploy if it throws. The stack copies the SQL files
// next to the bundle as `migrations/`.
export async function handler(): Promise<{ applied: string[] }> {
  // The runner works on whatever schema exists, so it isn't typed.
  const db = createDb<any>({ host: process.env.DSQL_ENDPOINT! });
  try {
    const migrations = await loadMigrations(path.join(__dirname, 'migrations'));
    const applied = await migrate(db, migrations, (message) => console.log(message));
    console.log(applied.length ? `applied ${applied.length} migration(s)` : 'schema is up to date');
    return { applied };
  } finally {
    await db.destroy();
  }
}
