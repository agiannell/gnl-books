import { afterEach, describe, expect, it, vi } from 'vitest';

const createDb = vi.fn((_config: { host: string; user?: string }) => ({}));

vi.mock('@gnl-books/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gnl-books/core')>()),
  createDb: (config: { host: string; user?: string }) => createDb(config),
}));

import { createApp } from '../src/app';

const env = {
  DSQL_ENDPOINT: 'abc.dsql.us-west-2.on.aws',
  USER_POOL_ID: 'us-west-2_example',
  USER_POOL_WEB_CLIENT_ID: 'client',
  PARENT_TOKEN_SECRET: 'local-secret',
};

describe('createApp database connection', () => {
  afterEach(() => createDb.mockClear());

  it('connects as the database role named in DSQL_USER', () => {
    createApp({ ...env, DSQL_USER: 'gnl_books_app' });
    expect(createDb).toHaveBeenCalledWith({ host: env.DSQL_ENDPOINT, user: 'gnl_books_app' });
  });

  // Local development and the live tests leave it unset and connect as admin.
  it.each([undefined, ''])('leaves the user to createDb’s default (admin) when DSQL_USER is %j', (value) => {
    createApp({ ...env, DSQL_USER: value });
    expect(createDb).toHaveBeenCalledWith({ host: env.DSQL_ENDPOINT, user: undefined });
  });
});
