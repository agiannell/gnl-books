import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const destroy = vi.fn(async () => {});
const createDb = vi.fn(() => ({ destroy }));
const loadMigrations = vi.fn(async (_dir: string) => [{ version: '0001_a', sql: 'select 1' }]);
const calls: string[] = [];
const migrate = vi.fn(async (_db: unknown, _migrations: unknown, _log?: (m: string) => void) => {
  calls.push('migrate');
  return ['0001_a'];
});
const provisionAppRole = vi.fn(async (_db: unknown, _config: unknown, _log?: (m: string) => void) => {
  calls.push('provision');
});

vi.mock('@gnl-books/core', () => ({
  createDb: (...args: unknown[]) => (createDb as (...a: unknown[]) => unknown)(...args),
  loadMigrations: (dir: string) => loadMigrations(dir),
  migrate: (...args: [unknown, unknown, ((m: string) => void)?]) => migrate(...args),
  provisionAppRole: (...args: [unknown, unknown, ((m: string) => void)?]) => provisionAppRole(...args),
}));

import { handler } from '../lambda/migrate';

const ROLE_ARN = 'arn:aws:iam::111111111111:role/api';

describe('migration handler', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv('DSQL_ENDPOINT', 'abc.dsql.us-west-2.on.aws');
    vi.stubEnv('DSQL_APP_USER', 'app_role');
    vi.stubEnv('DSQL_APP_ROLE_ARN', ROLE_ARN);
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

  it("sets up the API's database role after the migrations, so new tables are covered", async () => {
    await handler();
    expect(calls).toEqual(['migrate', 'provision']);
    expect(provisionAppRole.mock.calls[0][1]).toEqual({ role: 'app_role', roleArn: ROLE_ARN });
  });

  it('does not set the role up when a migration fails', async () => {
    migrate.mockRejectedValueOnce(new Error('boom'));
    await expect(handler()).rejects.toThrow('boom');
    expect(provisionAppRole).not.toHaveBeenCalled();
  });

  it('fails the deploy when role provisioning fails, and still closes the pool', async () => {
    provisionAppRole.mockRejectedValueOnce(new Error('no mapping'));
    await expect(handler()).rejects.toThrow('no mapping');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it.each(['DSQL_ENDPOINT', 'DSQL_APP_USER', 'DSQL_APP_ROLE_ARN'])('refuses to run without %s', async (name) => {
    vi.stubEnv(name, '');
    await expect(handler()).rejects.toThrow(`${name} is not set`);
    expect(createDb).not.toHaveBeenCalled();
  });
});
