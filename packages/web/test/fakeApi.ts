import { vi } from 'vitest';

/** One request the app made to the API. */
export interface Call {
  operationName: string;
  authorization: string | null;
}

/**
 * A stand-in for `fetch` that answers GraphQL requests by operation name. A
 * handler is the whole JSON response body (`{ data }` or `{ errors }`), or a
 * list of them: each request takes the next one, and the last repeats.
 * `variables[i]` belongs to `calls[i]`.
 */
export function fakeApi(handlers: Record<string, unknown>) {
  const calls: Call[] = [];
  const variables: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    const body = JSON.parse(String(init?.body)) as { operationName: string; variables?: Record<string, unknown> };
    const { operationName } = body;
    calls.push({ operationName, authorization: new Headers(init?.headers).get('authorization') });
    variables.push(body.variables ?? {});
    if (!(operationName in handlers)) throw new Error(`unexpected operation ${operationName}`);
    const handler = handlers[operationName];
    const reply = Array.isArray(handler) ? (handler.length > 1 ? handler.shift() : handler[0]) : handler;
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, variables, urls };
}
