import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const destroy = vi.fn(async () => {});
const createDb = vi.fn(() => ({ destroy }));
const loadMigrations = vi.fn(async (_dir: string) => [{ version: '0001_a', sql: 'select 1' }]);
const migrate = vi.fn(async (_db: unknown, _migrations: unknown, _log?: (m: string) => void) => ['0001_a']);

vi.mock('@gnl-books/core', () => ({
  createDb: (...args: unknown[]) => (createDb as (...a: unknown[]) => unknown)(...args),
  loadMigrations: (dir: string) => loadMigrations(dir),
  migrate: (...args: [unknown, unknown, ((m: string) => void)?]) => migrate(...args),
}));

import { handler } from '../lambda/migrate';

describe('migration handler', () => {
  beforeEach(() => {
    vi.stubEnv('DSQL_ENDPOINT', 'abc.dsql.us-west-2.on.aws');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('connects to the configured cluster and reports what it applied', async () => {
    await expect(handler()).resolves.toEqual({ applied: ['0001_a'] });
    expect(createDb).toHaveBeenCalledWith({ host: 'abc.dsql.us-west-2.on.aws' });
  });

  it('reads the migrations bundled next to the handler', async () => {
    await handler();
    const dir = loadMigrations.mock.calls[0][0];
    expect(path.basename(dir)).toBe('migrations');
    expect(path.dirname(dir)).toBe(path.resolve(__dirname, '..', 'lambda'));
  });

  it('closes the pool even when a migration fails, and lets the error fail the deploy', async () => {
    migrate.mockRejectedValueOnce(new Error('boom'));
    await expect(handler()).rejects.toThrow('boom');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
