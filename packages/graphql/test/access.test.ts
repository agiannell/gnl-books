import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '@gnl-books/core';

const { findFamilyIdForAccount, bootstrapFamily, attemptParentUnlock } = vi.hoisted(() => ({
  findFamilyIdForAccount: vi.fn(),
  bootstrapFamily: vi.fn(),
  attemptParentUnlock: vi.fn(),
}));
vi.mock('@gnl-books/core', async () => {
  const actual = await vi.importActual<typeof import('@gnl-books/core')>('@gnl-books/core');
  return {
    ...actual,
    findFamilyIdForAccount,
    getFamily: vi.fn(),
    bootstrapFamily,
    attemptParentUnlock,
    createDb: vi.fn(),
  };
});

import { createServer } from '../src/app';
import { buildContext } from '../src/context';
import { createParentTokens } from '../src/parentToken';

// The public endpoint's contract: with no valid bearer token, a caller gets
// nothing. These go through the real server, not just the schema.
const server = createServer();
const verifier = {
  // Two valid sign-ins in the same family: a parent's and a kid's.
  verify: async (token: string) => {
    if (token === 'good') return { sub: 'sub-123' };
    if (token === 'good-kid') return { sub: 'sub-456' };
    throw new Error('bad token');
  },
};

// A real signer, so the access tests exercise the real token rules.
const parentTokens = createParentTokens('s'.repeat(48));

// Records every catalog call, so a refused request can be shown never to have reached it.
const catalogCalls = vi.fn();
const books = {
  name: 'hardcover' as const,
  search: async (...args: unknown[]) => (catalogCalls(...args), []),
  getById: async (...args: unknown[]) => (catalogCalls(...args), null),
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
    context: () => buildContext({ db: {} as Db, verifier, parentTokens, books, authorization, parentToken: init.headers?.['x-parent-token'] }),
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
    ['a book search', { query: '{ searchBooks(query: "dog man") { title } }' }],
    ['a book import', { query: 'mutation { importBook(sourceId: "1") { id } }' }],
    ['a profile lookup', { query: '{ profile(id: "p-1") { name } }' }],
    ['a profile creation', { query: 'mutation { createProfile(input: { name: "A" }) { id } }' }],
  ])('refuses %s with a 401 and no data', async (_name, body) => {
    catalogCalls.mockClear();
    const res = await request({ body });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] });
    expect(res.body).not.toContain('"data"');
    // The public endpoint must not be a free proxy to the catalog (and its rate limit).
    expect(catalogCalls).not.toHaveBeenCalled();
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
        context: () => buildContext({ db: {} as Db, verifier, parentTokens, books, authorization: undefined }),
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

// The real signer through the real server: what a client actually does.
describe('the parent unlock, end to end', () => {
  const UNLOCK = 'mutation { unlockParent(pin: "4821") { token } }';
  const RENEW = 'mutation { renewParentUnlock { token expiresAt } }';
  const call = async (query: string, headers: Record<string, string>) =>
    JSON.parse((await request({ headers, body: { query } })).body);

  async function unlocked() {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    attemptParentUnlock.mockResolvedValue({ ok: true });
    return (await call(UNLOCK, { authorization: 'Bearer good' })).data.unlockParent.token as string;
  }

  it('lets the parent who entered the PIN do parent-only things with the token', async () => {
    const token = await unlocked();
    const body = await call(RENEW, { authorization: 'Bearer good', 'x-parent-token': token });
    expect(body.data.renewParentUnlock.token).toBeTruthy();
  });

  it('refuses the same call without the token', async () => {
    await unlocked();
    const body = await call(RENEW, { authorization: 'Bearer good' });
    expect(body.errors[0].extensions.code).toBe('FORBIDDEN');
  });

  it('refuses a token used by a different user, even in the same family', async () => {
    const token = await unlocked();
    findFamilyIdForAccount.mockResolvedValue('family-1');
    const body = await call(RENEW, { authorization: 'Bearer good-kid', 'x-parent-token': token });
    expect(body.errors[0].extensions.code).toBe('FORBIDDEN');
  });

  it('refuses a token used in a different family', async () => {
    const token = await unlocked();
    findFamilyIdForAccount.mockResolvedValue('family-2');
    const body = await call(RENEW, { authorization: 'Bearer good', 'x-parent-token': token });
    expect(body.errors[0].extensions.code).toBe('FORBIDDEN');
  });

  it('refuses a garbage token as not-a-parent, not as a server error', async () => {
    findFamilyIdForAccount.mockResolvedValue('family-1');
    const body = await call(RENEW, { authorization: 'Bearer good', 'x-parent-token': 'garbage' });
    expect(body.errors[0].extensions.code).toBe('FORBIDDEN');
  });

  it('does not honour a parent token without a valid sign-in', async () => {
    const token = await unlocked();
    const res = await request({ headers: { 'x-parent-token': token }, body: { query: RENEW } });
    expect(res.status).toBe(401);
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
