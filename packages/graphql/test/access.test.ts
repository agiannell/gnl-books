import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const { findFamilyIdForAccount, bootstrapFamily } = vi.hoisted(() => ({
  findFamilyIdForAccount: vi.fn(),
  bootstrapFamily: vi.fn(),
}));
vi.mock('@gnl-books/core', async () => {
  const actual = await vi.importActual<typeof import('@gnl-books/core')>('@gnl-books/core');
  return { ...actual, findFamilyIdForAccount, getFamily: vi.fn(), bootstrapFamily, createDb: vi.fn() };
});

import { createServer } from '../src/app';
import { buildContext } from '../src/context';

// The public endpoint's contract: with no valid bearer token, a caller gets
// nothing. These go through the real server, not just the schema.
const server = createServer();
const verifier = {
  verify: async (token: string) => {
    if (token !== 'good') throw new Error('bad token');
    return { sub: 'sub-123' };
  },
};

async function request(init: { headers?: Record<string, string>; method?: string; body?: unknown }) {
  const authorization = init.headers?.authorization;
  const res = await server.executeHTTPGraphQLRequest({
    httpGraphQLRequest: {
      method: init.method ?? 'POST',
      headers: new Map(Object.entries({ 'content-type': 'application/json', ...init.headers })) as never,
      search: '',
      body: init.body,
    },
    context: () => buildContext({ db: {} as Db, verifier, authorization }),
  });
  return { status: res.status ?? 200, body: res.body.kind === 'complete' ? res.body.string : '' };
}

beforeAll(() => server.start());
afterAll(() => server.stop());

describe('unauthenticated access', () => {
  it.each([
    ['a query', { query: '{ me { familyId } }' }],
    ['introspection', { query: '{ __schema { types { name } } }' }],
    ['the bootstrap mutation', { query: 'mutation { createFamily(familyName: "x", parentName: "y", pin: "1234") { id } }' }],
  ])('refuses %s with a 401 and no data', async (_name, body) => {
    const res = await request({ body });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] });
    expect(res.body).not.toContain('"data"');
  });

  // Apollo decides this when the server is constructed, and a Lambda has no
  // NODE_ENV (Vitest sets it to "test", which Apollo also treats as safe), so
  // build a fresh server the way the Lambda does.
  it('never includes a stack trace in an error, even with NODE_ENV unset', async () => {
    const original = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    const lambdaLike = createServer();
    if (original !== undefined) process.env.NODE_ENV = original;
    await lambdaLike.start();
    try {
      const res = await lambdaLike.executeHTTPGraphQLRequest({
        httpGraphQLRequest: {
          method: 'POST',
          headers: new Map([['content-type', 'application/json']]) as never,
          search: '',
          body: { query: '{ me { familyId } }' },
        },
        context: () => buildContext({ db: {} as Db, verifier, authorization: undefined }),
      });
      const body = res.body.kind === 'complete' ? res.body.string : '';
      expect(body).toContain('UNAUTHENTICATED');
      expect(body).not.toContain('stacktrace');
    } finally {
      await lambdaLike.stop();
    }
  });

  it('refuses an invalid token the same way', async () => {
    const res = await request({
      headers: { authorization: 'Bearer forged' },
      body: { query: '{ me { familyId } }' },
    });
    expect(res.status).toBe(401);
  });

  it('does not serve a landing page to a browser', async () => {
    const res = await request({ method: 'GET', headers: { accept: 'text/html' } });
    expect(res.body).not.toMatch(/<html/i);
  });
});

describe('unexpected failures', () => {
  // An internal error can carry a hostname, a SQL fragment, or a path.
  it('are reported without their message', async () => {
    findFamilyIdForAccount.mockResolvedValue(undefined);
    bootstrapFamily.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.3.7:5432 (secret-host.internal)'));
    const res = await request({
      headers: { authorization: 'Bearer good' },
      body: { query: 'mutation { createFamily(familyName: "x", parentName: "y", pin: "1234") { id } }' },
    });
    expect(res.body).not.toContain('ECONNREFUSED');
    expect(res.body).not.toContain('secret-host');
    expect(JSON.parse(res.body).errors[0]).toMatchObject({
      message: 'Internal server error',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  });
});

describe('authenticated access', () => {
  it('answers a caller with a valid token', async () => {
    findFamilyIdForAccount.mockResolvedValue(undefined);
    const res = await request({
      headers: { authorization: 'Bearer good' },
      body: { query: '{ me { familyId } }' },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ data: { me: { familyId: null } } });
  });
});
