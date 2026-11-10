import { vi } from 'vitest';

/** One request the app made to the API. */
export interface Call {
  operationName: string;
  authorization: string | null;
}

/**
 * A stand-in for `fetch` that answers GraphQL requests by operation name. A
 * handler is the whole JSON response body (`{ data }` or `{ errors }`), or a
 * list of them: each request takes the next one, and the last repeats. A handler
 * (or a list item) may instead be a function returning the body, or a promise of
 * it, so a test can hold a reply back. `variables[i]` and `queries[i]` (the
 * document text) belong to `calls[i]`.
 */
export function fakeApi(handlers: Record<string, unknown>) {
  const calls: Call[] = [];
  const variables: Record<string, unknown>[] = [];
  const queries: string[] = [];
  const urls: string[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    const body = JSON.parse(String(init?.body)) as {
      operationName: string;
      query?: string;
      variables?: Record<string, unknown>;
    };
    const { operationName } = body;
    calls.push({ operationName, authorization: new Headers(init?.headers).get('authorization') });
    variables.push(body.variables ?? {});
    queries.push(body.query ?? '');
    if (!(operationName in handlers)) throw new Error(`unexpected operation ${operationName}`);
    const handler = handlers[operationName];
    const picked = Array.isArray(handler) ? (handler.length > 1 ? handler.shift() : handler[0]) : handler;
    const reply = typeof picked === 'function' ? await (picked as () => unknown)() : picked;
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, variables, queries, urls };
}
